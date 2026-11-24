import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { upsertEntity } from '../../src/services/entities.js';
import { coerceDate, coerceMoney, coerceValue, resolveFields } from '../../src/services/fields.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'templates');
const opts = { dirs: [FIXTURES], today: '2026-03-15' };

async function withCtx(fn) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    initWorkspace(join(dir, 'ws'));
    ctx = openContext({ home: join(dir, 'ws'), user: 'tester', dbFile: ':memory:', env: {} });
    ctx.person = upsertEntity(ctx, { kind: 'person', name: 'Jordan Example', attrs: { address: '1 Sample Road\nExample City' } });
    ctx.client = upsertEntity(ctx, { kind: 'client', name: 'Example Client Org' });
    return await fn(ctx);
  } finally {
    ctx?.close();
    cleanup();
  }
}

test('every field source resolves; nothing missing when the asks are answered', () => withCtx(async (ctx) => {
  const { values, missing, errors } = await resolveFields(ctx, 'sample-letter', {
    person: 'jordan example', joining: '01/04/2026', salary: '₹50,000.50',
    perks: [{ label: 'Laptop', amount: 1200 }], team: 'design',
  }, opts);
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  assert.equal(values.brand.id, 'acme', 'brand: the resolved brand object');
  assert.equal(values.person.id, ctx.person.id, 'entity:person by name');
  assert.equal(values.address, '1 Sample Road\nExample City', '<field>.<path>');
  assert.equal(values.date, '2026-03-15', 'today');
  assert.equal(values.joining, '2026-04-01', 'date coerced from DD/MM/YYYY');
  assert.equal(values.salary, 5000050, 'money in minor units');
  assert.equal(values.annual, 60000600, 'computed (already minor units, not scaled again)');
  assert.equal(values.bank.ifsc, 'EXMP0000000', 'brand.<path> with an array index');
  assert.deepEqual(values.issuer, { name: 'Acme Events Private Limited' }, 'dotted field names nest');
  assert.equal(values.signatory.id, 'md', 'signatory defaults from brand.defaultSignatory[category]');
  assert.equal(values.signatory.name, 'Sam Sample');
  assert.equal(values.taxMode, 'cgst_sgst', 'default read from a brand path');
  assert.equal(values.probationMonths, 6, 'const:<json>');
  assert.equal(values.remote, false, 'literal default');
  assert.deepEqual(values.perks, [{ label: 'Laptop', amount: 120000 }], 'array items coerced by item type');
  assert.equal(values.team, 'design');
}));

test('required fields left empty are listed in missing with label, type, enum and help', () => withCtx(async (ctx) => {
  const { values, missing, errors } = await resolveFields(ctx, 'sample-letter', {}, opts);
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, [
    { name: 'person', label: 'Employee', type: 'entity' },
    { name: 'joining', label: 'Joining date', type: 'date', help: 'First working day' },
    { name: 'salary', label: 'Monthly salary', type: 'money' },
  ]);
  assert.equal(values.address, undefined);
  assert.equal(values.annual, undefined);
  assert.ok(!('person' in values));
}));

test('input overrides non-ask sources (today, const, brand path, signatory, computed)', () => withCtx(async (ctx) => {
  const { values, errors } = await resolveFields(ctx, 'sample-letter', {
    person: ctx.person.id, joining: '2026-04-01', salary: 100, date: '2026-01-02', probationMonths: '3',
    'issuer.name': 'Override Name', signatory: 'ops', annual: 999, taxMode: 'igst', address: 'Somewhere else',
  }, opts);
  assert.deepEqual(errors, []);
  assert.equal(values.person.name, 'Jordan Example', 'entity by id');
  assert.equal(values.date, '2026-01-02');
  assert.equal(values.probationMonths, 3);
  assert.equal(values.issuer.name, 'Override Name');
  assert.equal(values.signatory.id, 'ops');
  assert.equal(values.annual, 99900, 'input money is major units');
  assert.equal(values.taxMode, 'igst');
  assert.equal(values.address, 'Somewhere else');
}));

test('bad values, unknown entities and signatories and enum violations are reported as errors', () => withCtx(async (ctx) => {
  const { errors } = await resolveFields(ctx, 'sample-letter', {
    person: 'Nobody Known', joining: '31/02/2026', salary: 'lots', signatory: 'ghost', taxMode: 'vat', team: 'sales',
    remote: 'maybe', perks: [{ label: 'x', amount: 'abc' }, 'oops'],
  }, opts);
  const byName = Object.fromEntries(errors.map((e) => [e.name, e.message]));
  assert.match(byName.person, /Nobody Known/);
  assert.match(byName.joining, /not a date/);
  assert.match(byName.salary, /not an amount/);
  assert.match(byName.signatory, /no signatory "ghost"/);
  assert.match(byName.taxMode, /not one of none, cgst_sgst, igst/);
  assert.match(byName.team, /not one of design, operations/);
  assert.match(byName.remote, /yes\/no/);
  assert.match(byName['perks.0.amount'], /not an amount/);
  assert.match(byName['perks.1'], /expected an object/);
}));

test('an entity id of the wrong kind is an error', () => withCtx(async (ctx) => {
  const { errors } = await resolveFields(ctx, 'sample-letter', { person: ctx.client.id }, opts);
  assert.match(errors.find((e) => e.name === 'person').message, /No person matches/);
}));

test('the default signatory is brand.defaultSignatory[templateId] before [category]', () => withCtx(async (ctx) => {
  const dir = join(ctx.ws.templatesDir, 'invoice');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'template.json'), readFileSync(join(FIXTURES, 'sample-letter', 'template.json'), 'utf8').replace('"sample-letter"', '"invoice"'));
  copyFileSync(join(FIXTURES, 'sample-letter', 'index.js'), join(dir, 'index.js'));
  const { values } = await resolveFields(ctx, 'invoice', {}, opts);
  assert.equal(values.signatory.id, 'ops', 'defaultSignatory.invoice wins over defaultSignatory.letter');
}));

test('brandId picks the brand; an unknown brand throws BRAND_NOT_FOUND', () => withCtx(async (ctx) => {
  await assert.rejects(resolveFields(ctx, 'sample-letter', {}, { ...opts, brandId: 'nope' }), (e) => e.code === 'BRAND_NOT_FOUND');
}));

test('money coercion: numbers and strings in major units to integer minor units', () => {
  assert.deepEqual(coerceMoney(1500), { value: 150000 });
  assert.deepEqual(coerceMoney(1.005), { value: 101 });
  assert.deepEqual(coerceMoney(0.1 + 0.2), { value: 30 });
  assert.deepEqual(coerceMoney('1,20,000'), { value: 12000000 });
  assert.deepEqual(coerceMoney('₹ 1,20,000.5'), { value: 12000050 });
  assert.deepEqual(coerceMoney('-25.255'), { value: -2526 });
  assert.deepEqual(coerceMoney('12.'), { value: 1200 });
  assert.ok(coerceMoney('12abc').error);
  assert.ok(coerceMoney(Number.NaN).error);
  assert.ok(coerceMoney({}).error);
  assert.deepEqual(coerceValue('money', 150000, { minor: true }), { value: 150000 });
  assert.ok(coerceValue('money', 1.5, { minor: true }).error);
});

test('date coercion to ISO YYYY-MM-DD', () => {
  assert.deepEqual(coerceDate('2026-08-29'), { value: '2026-08-29' });
  assert.deepEqual(coerceDate('2026-08-29T10:00:00Z'), { value: '2026-08-29' });
  assert.deepEqual(coerceDate('29/08/2026'), { value: '2026-08-29' });
  assert.deepEqual(coerceDate('9-8-2026'), { value: '2026-08-09' });
  assert.deepEqual(coerceDate(new Date(2026, 7, 29)), { value: '2026-08-29' });
  assert.ok(coerceDate('2026-02-30').error);
  assert.ok(coerceDate('August 29').error);
  assert.ok(coerceDate(new Date('x')).error);
});

test('other coercions: number, boolean, string, array, object', () => {
  assert.deepEqual(coerceValue('number', '1,234.5'), { value: 1234.5 });
  assert.ok(coerceValue('number', '').error);
  assert.deepEqual(coerceValue('boolean', 'Yes'), { value: true });
  assert.deepEqual(coerceValue('boolean', 0), { value: false });
  assert.deepEqual(coerceValue('string', '  padded  '), { value: 'padded' });
  assert.deepEqual(coerceValue('text', '  kept  '), { value: '  kept  ' });
  assert.deepEqual(coerceValue('string', 42), { value: '42' });
  assert.ok(coerceValue('string', { a: 1 }).error);
  assert.ok(coerceValue('array', 'x').error);
  assert.ok(coerceValue('object', []).error);
});
