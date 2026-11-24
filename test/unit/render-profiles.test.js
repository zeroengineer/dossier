import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, getProfile } from '../../src/render/pdf/profiles.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('shipped profiles carry the discovered margins and A4 size', () => {
  for (const p of Object.values(PROFILES)) {
    assert.equal(p.PW, 595.28);
    assert.equal(p.PH, 841.89);
    close(p.CW, p.PW - p.ML - p.MR);
  }
  assert.deepEqual({ ...PROFILES.invoice, CW: undefined }, { PW: 595.28, PH: 841.89, ML: 40, MR: 40, MT: 40, MB: 40, CP: 0, CW: undefined });
  close(PROFILES.invoice.CW, 515.28);
  assert.equal(PROFILES.letter.MT, 100);
  assert.equal(PROFILES.letter.MB, 39);
  assert.equal(PROFILES.letter.CP, 10);
  assert.equal(PROFILES.letter.LOGO_H, 32);
  close(PROFILES.letter.CW, 520.28);
  assert.equal(PROFILES.settlement.CP, 12);
  assert.equal(PROFILES.settlement.ML, 37.5);
  assert.deepEqual([PROFILES.proposal.ML, PROFILES.proposal.MT, PROFILES.proposal.MB, PROFILES.proposal.CP], [40, 100, 42, 12]);
  close(PROFILES.compact.CW, 511.28);
  assert.equal(PROFILES.compact.CP, 14);
  assert.deepEqual([PROFILES.mou.ML, PROFILES.mou.MT, PROFILES.mou.MB, PROFILES.mou.CP], [45, 50, 50, 0]);
  close(PROFILES.mou.CW, 505.28);
});

test('getProfile applies brand overrides for that profile and recomputes CW', () => {
  const p = getProfile('letter', { letter: { ML: 42, MR: 42, CP: 14, CW: 1 }, invoice: { ML: 1 } });
  assert.equal(p.ML, 42);
  assert.equal(p.CP, 14);
  close(p.CW, 511.28);
  assert.equal(p.MT, 100);
  assert.equal(getProfile('invoice', undefined), PROFILES.invoice);
  assert.equal(getProfile('mou', { letter: { ML: 1 } }), PROFILES.mou);
  assert.ok(Object.isFrozen(p));
});

test('getProfile rejects unknown profiles and bad override values', () => {
  assert.throws(() => getProfile('nope'), /unknown layout profile "nope"/);
  assert.throws(() => getProfile('letter', { letter: { ML: '40' } }), /layoutProfiles\.letter\.ML/);
  assert.throws(() => getProfile('letter', { letter: { MT: -1 } }), /non-negative/);
});
