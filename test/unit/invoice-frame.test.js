import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotals, mergeStyle, parseRowHeight } from '../../src/render/pdf/invoiceFrame.js';

const CGST_SGST = { rates: [{ label: 'CGST (9%)', rate: 0.09 }, { label: 'SGST (9%)', rate: 0.09 }] };
const IGST = { rates: [{ label: 'IGST @ 18%', rate: 0.18 }] };

test('invoiceTotals: tax on the subtotal, half up, odd paisa on the last line', () => {
  // 194.05 × 18% = 34.929 -> 34.93; split 17.46 / 17.47 (legacy).
  const t = invoiceTotals([{ amount: 19405 }], CGST_SGST);
  assert.deepEqual(t.taxes.map((x) => x.amount), [1746, 1747]);
  assert.equal(t.taxTotal, 3493);
  assert.equal(t.total, 19405 + 3493);
  assert.deepEqual(invoiceTotals([{ amount: 1500000 }], CGST_SGST).taxes.map((x) => x.amount), [135000, 135000]);
  // Half up at the paisa: 0.25 × 18% = 0.045 -> 0.05.
  assert.equal(invoiceTotals([{ amount: 25 }], IGST).taxTotal, 5);
  assert.deepEqual(invoiceTotals([{ amount: 57464 }], CGST_SGST).taxes.map((x) => x.amount), [5172, 5172]);
  const many = invoiceTotals([{ amount: 306650 }, { amount: 20000 }, { amount: 30400 }], null);
  assert.deepEqual(many, { subtotal: 357050, taxes: [], taxTotal: 0, total: 357050 });
  assert.deepEqual(invoiceTotals([], IGST), { subtotal: 0, taxes: [{ label: 'IGST @ 18%', rate: 0.18, amount: 0 }], taxTotal: 0, total: 0 });
});

test('invoiceTotals: shares always add up to the total tax', () => {
  for (let a = 1; a < 3000; a += 7) {
    const t = invoiceTotals([{ amount: a }], CGST_SGST);
    assert.equal(t.taxes[0].amount + t.taxes[1].amount, t.taxTotal);
    assert.ok(t.taxes[1].amount - t.taxes[0].amount <= 1 && t.taxes[1].amount >= t.taxes[0].amount, `split of ${a}`);
  }
  assert.throws(() => invoiceTotals([{ amount: 1.5 }], null), /item 1: amount must be an integer/);
  assert.throws(() => invoiceTotals([{}], null), /item 1/);
});

test('parseRowHeight accepts points or "auto"', () => {
  assert.equal(parseRowHeight(undefined), 'auto');
  assert.equal(parseRowHeight('auto'), 'auto');
  assert.equal(parseRowHeight(105), 105);
  assert.equal(parseRowHeight(' 44 '), 44);
  for (const bad of [0, -1, 'tall', {}, Infinity]) assert.throws(() => parseRowHeight(bad), /row height/);
});

test('mergeStyle deep-merges objects and replaces arrays and scalars', () => {
  const base = { a: { b: 1, c: [1, 2] }, d: 2 };
  assert.deepEqual(mergeStyle(base, { a: { c: [3] }, d: null }), { a: { b: 1, c: [3] }, d: null });
  assert.equal(mergeStyle(base, undefined), base);
});
