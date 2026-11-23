import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName } from '../../src/services/entities.js';
import { canonicalKey } from '../../src/domain/canonical.js';
import { DossierError, isDossierError } from '../../src/errors.js';

test('normaliseName: case, trim and whitespace', () => {
  assert.equal(normaliseName('  Acme   Events\tPrivate\nLimited  '), 'acme events private limited');
  assert.equal(normaliseName('ACME EVENTS'), 'acme events');
  assert.equal(normaliseName('Ｅxample'), 'example');
});

test('normaliseName: strips punctuation except & and apostrophe', () => {
  assert.equal(normaliseName('Acme Events, Pvt. Ltd.'), 'acme events pvt ltd');
  assert.equal(normaliseName('Sound & Light (Example) Co.'), 'sound & light example co');
  assert.equal(normaliseName("Jordan's Studio!"), "jordan's studio");
  assert.equal(normaliseName('a_b/c:d;e?f'), 'a b c d e f');
  assert.equal(normaliseName('"Quoted" Name'), 'quoted name');
  assert.equal(normaliseName('...'), '');
  assert.equal(normaliseName(null), '');
});

test('normaliseName: unifies quotes and dashes', () => {
  assert.equal(normaliseName('O’Brien'), "o'brien");
  assert.equal(normaliseName('O‘Brien'), "o'brien");
  assert.equal(normaliseName('“Quoted” Name'), 'quoted name');
  for (const dash of ['-', '‐', '‑', '–', '—', '−']) {
    assert.equal(normaliseName(`Example Fest 2026 ${dash} Sample College`), 'example fest 2026 - sample college');
  }
  assert.equal(normaliseName('co–op'), 'co-op');
});

test('canonicalKey is the same function as normaliseName', () => {
  assert.equal(canonicalKey, normaliseName);
});

test('DossierError carries an UPPER_SNAKE code and details', () => {
  const err = new DossierError('ENTITY_DUPLICATE', 'already exists', { existingId: 3 });
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'DossierError');
  assert.equal(err.code, 'ENTITY_DUPLICATE');
  assert.deepEqual(err.details, { existingId: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(err)), { code: 'ENTITY_DUPLICATE', message: 'already exists', details: { existingId: 3 } });
  assert.ok(isDossierError(err, 'ENTITY_DUPLICATE'));
  assert.ok(!isDossierError(err, 'NOT_FOUND'));
  assert.deepEqual(new DossierError('NOT_FOUND', 'x').details, {});
  assert.throws(() => new DossierError('notSnake', 'x'), TypeError);
});
