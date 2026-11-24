import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FEE_RATES, delegatePaid, feeRates, organiserPaid, ticketCharges } from '../../src/render/feeCalculator.js';

// The legacy report/proposal maths (rupees as floats, `r2` after every step).
const r2 = (n) => Math.round(n * 100) / 100;
function legacyCalc(base, { platformPercent: p, gstPercent: g, gatewayPercent: pg, gatewayGstPercent: pgg }) {
  const pf = r2(base * p / 100);
  const pfGst = r2(pf * g / 100);
  const processed = r2(base + pf + pfGst);
  const pgFee = r2(processed * pg / 100);
  const pgGst = r2(pgFee * pgg / 100);
  const delegateTotal = r2(processed + pgFee + pgGst);
  const orgPg = r2(base * pg / 100);
  const orgPgGst = r2(orgPg * pgg / 100);
  const orgNet = r2(base - pf - pfGst - orgPg - orgPgGst);
  return [pf, pfGst, processed, pgFee, pgGst, delegateTotal, orgPg, orgPgGst, orgNet].map((x) => Math.round(x * 100));
}
const KEYS = ['platformFee', 'platformGst', 'processed', 'gatewayFee', 'gatewayGst', 'delegateTotal', 'orgGatewayFee', 'orgGatewayGst', 'orgNet'];
// For each rounded step: the minor amount it is a percentage of (by index into KEYS, -1 = base) and its rate key.
const STEPS = { 0: [-1, 'platformPercent'], 1: [0, 'gstPercent'], 3: [2, 'gatewayPercent'], 4: [3, 'gatewayGstPercent'], 6: [-1, 'gatewayPercent'], 7: [6, 'gatewayGstPercent'] };

test('ticketCharges: the legacy worked examples (DISCOVERY A8 §13-14)', () => {
  // Pricing report, ₹1,000 at 2% + 18%, gateway 2% + 18%.
  assert.deepEqual({ ...ticketCharges(100000) }, {
    base: 100000, platformFee: 2000, platformGst: 360, processed: 102360, gatewayFee: 2047, gatewayGst: 368,
    delegateTotal: 104775, totalCharges: 4775, received: 100000, orgGatewayFee: 2000, orgGatewayGst: 360, orgCharges: 4720, orgNet: 95280,
  });
  // Tiered report at 2.5%: ₹250 -> 6.25, 1.13, 257.38, 5.15, 0.93, 263.46; ₹450 -> 11.25, 2.03, 463.28, 9.27, 1.67, 474.22.
  const t1 = ticketCharges(25000, { platformPercent: 2.5 });
  assert.deepEqual([t1.platformFee, t1.platformGst, t1.processed, t1.gatewayFee, t1.gatewayGst, t1.delegateTotal], [625, 113, 25738, 515, 93, 26346]);
  const t2 = ticketCharges(45000, { platformPercent: 2.5 });
  assert.deepEqual([t2.platformFee, t2.platformGst, t2.processed, t2.gatewayFee, t2.gatewayGst, t2.delegateTotal], [1125, 203, 46328, 927, 167, 47422]);
  // Proposal registration table: ₹4,720 -> 94.40, 16.99, 96.63, 17.39, charges 225.41, total 4,945.41; USD 250 at 3% gateway.
  const r = ticketCharges(472000);
  assert.deepEqual([r.platformFee, r.platformGst, r.gatewayFee, r.gatewayGst, r.totalCharges, r.delegateTotal], [9440, 1699, 9663, 1739, 22541, 494541]);
  const u = ticketCharges(25000, { gatewayPercent: 3 });
  assert.deepEqual([u.platformFee, u.platformGst, u.gatewayFee, u.gatewayGst, u.totalCharges, u.delegateTotal], [500, 90, 768, 138, 1496, 26496]);
  assert.deepEqual(delegatePaid(100000), {
    base: 100000, platformFee: 2000, platformGst: 360, processed: 102360, gatewayFee: 2047, gatewayGst: 368, paidByDelegate: 104775, receivedByOrganiser: 100000,
  });
  assert.deepEqual(organiserPaid(100000), { paidByDelegate: 100000, platformFee: 2000, platformGst: 360, gatewayFee: 2000, gatewayGst: 360, receivedByOrganiser: 95280 });
  assert.deepEqual({ ...ticketCharges(0) }.delegateTotal, 0);
});

test('ticketCharges matches the legacy float maths except where it rounded an exact half paisa down', () => {
  const rateSets = [DEFAULT_FEE_RATES, { ...DEFAULT_FEE_RATES, platformPercent: 2.5 }, { ...DEFAULT_FEE_RATES, platformPercent: 1.5 }, { ...DEFAULT_FEE_RATES, gatewayPercent: 3 }];
  for (const rates of rateSets) {
    let differences = 0;
    for (let rupees = 0; rupees <= 20000; rupees++) {
      const legacy = legacyCalc(rupees, rates);
      const c = ticketCharges(rupees * 100, rates);
      const ours = KEYS.map((k) => c[k]);
      const k = ours.findIndex((v, i) => v !== legacy[i]);
      if (k === -1) continue;
      differences++;
      // The first step that differs is a rounded percentage whose exact value is x.5 minor units; ours rounds it up.
      assert.ok(STEPS[k], `₹${rupees} ${JSON.stringify(rates)}: first difference at ${KEYS[k]} (not a rounded step)`);
      const [of, rateKey] = STEPS[k];
      const amount = of === -1 ? rupees * 100 : ours[of];
      const units = Math.round(rates[rateKey] * 10000);
      assert.equal((amount * units) % 1000000, 500000, `₹${rupees}: ${KEYS[k]} is not an exact half`);
      assert.equal(ours[k], legacy[k] + 1, `₹${rupees}: ${KEYS[k]} rounds the half up`);
    }
    assert.ok(differences < 1000, `${differences} differences`);
  }
});

test('feeRates: layers, validation, string percentages', () => {
  assert.deepEqual({ ...feeRates() }, DEFAULT_FEE_RATES);
  assert.deepEqual({ ...feeRates({ platformPercent: 1.5 }, { gatewayPercent: '3%', gstPercent: null }) },
    { platformPercent: 1.5, gstPercent: 18, gatewayPercent: 3, gatewayGstPercent: 18 });
  assert.throws(() => feeRates({ platform: 2 }), /unknown fee rate "platform"/);
  assert.throws(() => feeRates({ gstPercent: 101 }), /gstPercent must be a number from 0 to 100/);
  assert.throws(() => feeRates({ gstPercent: 'abc' }), /gstPercent must be a number/);
  assert.throws(() => feeRates([1]), /must be an object/);
  assert.throws(() => ticketCharges(-1), /non-negative amount/);
  assert.throws(() => ticketCharges(1.5), /non-negative amount/);
});
