// Ticket fee calculators of the proposals and pricing reports (docs/DISCOVERY.md A8 §13-14; legacy `calc(base)`):
// a platform fee with GST on it, and a payment gateway fee with GST on it, under two models. Delegate Paid: the
// delegate pays the base price plus every charge (the gateway fee is charged on base + platform fee + its GST) and the
// organiser receives the base price. Organiser Paid: the delegate pays the base price and the organiser bears the
// charges (the gateway fee is charged on the base price). Pure functions over integer minor units; the rates are
// percentages (params). Each charge is rounded half up to a whole minor unit with exact integer arithmetic
// (`percentOf`); the legacy scripts used `Math.round(x * 100) / 100` on floats, which rounds an exact half paisa down
// when the float product lands just below it (e.g. 18% of ₹5.75 = 103.5 paise: legacy 103, here 104). Every other
// result is identical (test/unit/fee-calculator.test.js sweeps the legacy maths).
import { percentOf, percentUnits } from './statementTemplate.js';

/** Rate keys, in percent. */
export const FEE_RATE_KEYS = Object.freeze(['platformPercent', 'gstPercent', 'gatewayPercent', 'gatewayGstPercent']);

/** Neutral defaults (overridden by `params.fees`, the `fees` field and a table's own `rates`). */
export const DEFAULT_FEE_RATES = Object.freeze({ platformPercent: 2, gstPercent: 18, gatewayPercent: 2, gatewayGstPercent: 18 });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Merge rate layers (later wins; `undefined`/`null` keys are skipped) over DEFAULT_FEE_RATES and check each rate is a
 * percentage from 0 to 100 with at most 4 decimals. Numeric strings (`"2.5"`) are accepted.
 * @param {...(Record<string, unknown>|undefined|null)} layers
 * @returns {Readonly<{ platformPercent: number, gstPercent: number, gatewayPercent: number, gatewayGstPercent: number }>}
 */
export function feeRates(...layers) {
  const out = { ...DEFAULT_FEE_RATES };
  for (const layer of layers) {
    if (layer === undefined || layer === null) continue;
    if (!isPlainObject(layer)) throw new Error('fee rates must be an object of percentages');
    for (const [k, v] of Object.entries(layer)) {
      if (!FEE_RATE_KEYS.includes(k)) throw new Error(`unknown fee rate "${k}" (known: ${FEE_RATE_KEYS.join(', ')})`);
      if (v === undefined || v === null || v === '') continue;
      const n = typeof v === 'string' ? Number(v.trim().replace(/%$/, '')) : v;
      percentUnits(n, k);
      out[k] = n;
    }
  }
  return Object.freeze(out);
}

/**
 * Charges on one ticket of `base` minor units.
 * Delegate Paid: `platformFee` = platform % of base, `platformGst` = GST % of it, `processed` = base + both,
 * `gatewayFee` = gateway % of processed, `gatewayGst`, `delegateTotal` = processed + gateway fee + its GST,
 * `totalCharges` = delegateTotal - base, `received` = base. Organiser Paid: `orgGatewayFee` = gateway % of base,
 * `orgGatewayGst`, `orgCharges` = platform fee + GST + gateway fee + GST, `orgNet` = base - orgCharges.
 * @param {number} base non-negative integer minor units
 * @param {Record<string, unknown>} [rates] see feeRates
 */
export function ticketCharges(base, rates) {
  if (!Number.isSafeInteger(base) || base < 0) throw new Error('the base price must be a non-negative amount');
  const r = feeRates(rates);
  const platformFee = percentOf(base, r.platformPercent);
  const platformGst = percentOf(platformFee, r.gstPercent);
  const processed = base + platformFee + platformGst;
  const gatewayFee = percentOf(processed, r.gatewayPercent);
  const gatewayGst = percentOf(gatewayFee, r.gatewayGstPercent);
  const delegateTotal = processed + gatewayFee + gatewayGst;
  const orgGatewayFee = percentOf(base, r.gatewayPercent);
  const orgGatewayGst = percentOf(orgGatewayFee, r.gatewayGstPercent);
  const orgCharges = platformFee + platformGst + orgGatewayFee + orgGatewayGst;
  return Object.freeze({
    base, platformFee, platformGst, processed, gatewayFee, gatewayGst, delegateTotal,
    totalCharges: delegateTotal - base, received: base,
    orgGatewayFee, orgGatewayGst, orgCharges, orgNet: base - orgCharges,
  });
}

/** Metric names a fee table may print (keys of ticketCharges). */
export const FEE_METRICS = Object.freeze([
  'base', 'platformFee', 'platformGst', 'processed', 'gatewayFee', 'gatewayGst', 'delegateTotal', 'totalCharges',
  'received', 'orgGatewayFee', 'orgGatewayGst', 'orgCharges', 'orgNet',
]);

/**
 * The Delegate Paid model of one ticket.
 * @param {number} base @param {Record<string, unknown>} [rates]
 */
export function delegatePaid(base, rates) {
  const c = ticketCharges(base, rates);
  return {
    base: c.base, platformFee: c.platformFee, platformGst: c.platformGst, processed: c.processed,
    gatewayFee: c.gatewayFee, gatewayGst: c.gatewayGst, paidByDelegate: c.delegateTotal, receivedByOrganiser: c.base,
  };
}

/**
 * The Organiser Paid model of one ticket.
 * @param {number} base @param {Record<string, unknown>} [rates]
 */
export function organiserPaid(base, rates) {
  const c = ticketCharges(base, rates);
  return {
    paidByDelegate: c.base, platformFee: c.platformFee, platformGst: c.platformGst, gatewayFee: c.orgGatewayFee,
    gatewayGst: c.orgGatewayGst, receivedByOrganiser: c.orgNet,
  };
}
