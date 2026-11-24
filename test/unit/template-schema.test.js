import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSource, validateTemplateMeta } from '../../src/workspace/templateSchema.js';

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'templates', 'sample-letter', 'template.json'), 'utf8'));
const base = () => structuredClone(FIXTURE);
const errorOf = (meta) => {
  const r = validateTemplateMeta(meta);
  assert.ok(r.error, 'expected a validation error');
  return r.error;
};

test('the fixture template validates and gets defaults', () => {
  const meta = base();
  delete meta.renditions;
  delete meta.relations;
  delete meta.numbering;
  delete meta.contact;
  delete meta.params;
  const { data } = validateTemplateMeta(meta);
  assert.deepEqual(data.renditions, ['pdf', 'html', 'md']);
  assert.deepEqual(data.relations, []);
  assert.equal(data.numbering, null);
  assert.equal(data.contact, 'default');
  assert.deepEqual(data.params, {});
  assert.equal(data.fields.find((f) => f.name === 'date').required, false);
});

test('missing and wrongly typed top-level keys are reported by path', () => {
  const meta = base();
  delete meta.title;
  meta.version = 1.5;
  meta.category = 'memo';
  meta.layoutProfile = 'poster';
  meta.sensitivity = 'Secret';
  const err = errorOf(meta);
  assert.match(err, /^title: /m);
  assert.match(err, /^version: /m);
  assert.match(err, /^category: /m);
  assert.match(err, /^layoutProfile: /m);
  assert.match(err, /^sensitivity: /m);
});

test('unknown keys are rejected (typos do not pass silently)', () => {
  const meta = base();
  meta.titel = 'x';
  meta.fields[0].requird = true;
  const err = errorOf(meta);
  assert.match(err, /titel/);
  assert.match(err, /fields\.0.*requird/s);
});

test('field sources: bad syntax, unknown kinds and forward references fail', () => {
  const cases = [
    ['nonsense', /unknown source "nonsense"/],
    ['entity:planet', /unknown entity kind "planet"/],
    ['const:{oops', /not valid JSON/],
    ['computed:bad-name', /bad computed function name/],
    ['later.attrs.x', /"later" is not a field declared before/],
  ];
  for (const [source, re] of cases) {
    const meta = base();
    meta.fields.push({ name: 'extra', source });
    assert.match(errorOf(meta), re, source);
  }
});

test('duplicate fields, item on a non-array, enum on a number and relation to an unknown field fail', () => {
  const meta = base();
  meta.fields.push({ name: 'salary', source: 'ask' });
  meta.fields.push({ name: 'x', source: 'ask', type: 'string', item: { a: 'string' } });
  meta.fields.push({ name: 'y', source: 'ask', type: 'number', enum: ['1'] });
  meta.relations.push({ type: 'pays', field: 'nope' });
  const err = errorOf(meta);
  assert.match(err, /duplicate field "salary"/);
  assert.match(err, /only array fields take "item"/);
  assert.match(err, /"enum" needs type/);
  assert.match(err, /relations\.1\.field: no field "nope"/);
  const bad = base();
  bad.relations.push({ type: 'likes', field: 'person' });
  assert.match(errorOf(bad), /relations\.1\.type/);
});

test('numbering takes "brand" or a series id', () => {
  const meta = base();
  meta.numbering = { series: 'Not An Id' };
  assert.match(errorOf(meta), /numbering\.series: must be "brand" or a series id/);
  meta.numbering = { series: 'invoice-main' };
  assert.equal(validateTemplateMeta(meta).data.numbering.required, true);
});

test('parseSource classifies every source kind', () => {
  assert.deepEqual(parseSource('ask'), { kind: 'ask' });
  assert.deepEqual(parseSource('today'), { kind: 'today' });
  assert.deepEqual(parseSource('brand'), { kind: 'brand' });
  assert.deepEqual(parseSource('signatory'), { kind: 'signatory' });
  assert.deepEqual(parseSource('brand.bankAccounts.0'), { kind: 'brandPath', arg: 'bankAccounts.0' });
  assert.deepEqual(parseSource('brand.bankAccounts[0].ifsc'), { kind: 'brandPath', arg: 'bankAccounts[0].ifsc' });
  assert.deepEqual(parseSource('entity:client'), { kind: 'entity', arg: 'client' });
  assert.deepEqual(parseSource('computed:total'), { kind: 'computed', arg: 'total' });
  assert.deepEqual(parseSource('const:{"a":[1]}'), { kind: 'const', arg: { a: [1] } });
  assert.deepEqual(parseSource('client.attrs.address'), { kind: 'fieldPath', arg: 'client.attrs.address', root: 'client' });
});

test('field names may not use __proto__, constructor or prototype segments', () => {
  for (const name of ['__proto__', 'a.constructor', 'prototype.x']) {
    const meta = base();
    meta.fields.push({ name, source: 'ask' });
    assert.match(errorOf(meta), /must not use __proto__, constructor, prototype/, name);
  }
});
