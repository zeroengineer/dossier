import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientSettlement, detailRows, divHalfUp, employeeSettlement, expenseTotals, percentOf, percentUnits, ticketingSettlement,
} from '../../src/render/statementTemplate.js';

test('divHalfUp rounds half up in exact integers', () => {
  assert.equal(divHalfUp(2000000, 25), 80000);
  assert.equal(divHalfUp(2000000, 31), 64516); // ₹645.16, the legacy 31-day per-day salary
  assert.equal(divHalfUp(5, 2), 3);
  assert.equal(divHalfUp(4, 3), 1);
  assert.throws(() => divHalfUp(1, 0), RangeError);
  assert.throws(() => divHalfUp(-1, 2), RangeError);
});

test('percentOf: legacy paise maths (fee then GST on the rounded fee), exact halves round up', () => {
  assert.equal(percentOf(5487100, 1.5), 82307); // 82306.5 paise
  assert.equal(percentOf(82307, 18), 14815);
  assert.equal(percentOf(1500000, 18), 270000);
  assert.equal(percentOf(100, 0.5), 1);
  assert.equal(percentOf(123456, 0), 0);
  assert.equal(percentOf(9_000_000_000_000, 18), 1_620_000_000_000); // BigInt inside: no precision loss
  // Same result as the legacy Math.round(paise * rate) over a sweep of amounts.
  for (let g = 0; g < 200000; g += 7) {
    assert.equal(percentOf(g, 1.5), Math.round(g * 0.015), `1.5% of ${g}`);
    assert.equal(percentOf(g, 18), Math.round(g * 0.18), `18% of ${g}`);
  }
  assert.equal(percentUnits(2.25), 22500);
  assert.throws(() => percentUnits(1.00001), /at most 4 decimals/);
  assert.throws(() => percentUnits(-1), /from 0 to 100/);
  assert.throws(() => percentUnits('2'), /from 0 to 100/);
  assert.throws(() => percentOf(-5, 1), /non-negative/);
});

test('employee settlement: per-day and half-day rates, attendance, other deductions and additions in paise', () => {
  const s = employeeSettlement({
    monthlySalary: 2000000, workingDays: 25,
    attendance: [{ label: 'Late', days: 16, rule: 'half' }, { label: 'LOP', days: 2, rule: 'full' }, { label: 'Short', days: 3, rule: 'half' }],
  });
  assert.deepEqual([s.perDay, s.halfDay, s.totalDeductions, s.net], [80000, 40000, 920000, 1080000]);
  assert.deepEqual(s.attendance.map((a) => a.amount), [640000, 160000, 120000]);

  const t = employeeSettlement({
    monthlySalary: 2000000, workingDays: 31, attendance: [{ label: 'LOP', days: 1.5 }],
    deductions: [{ label: 'Advance', amount: 50000 }], additions: [{ label: 'Bonus', amount: 100000 }],
  });
  assert.equal(t.perDay, 64516);
  assert.equal(t.halfDay, 32258);
  assert.equal(t.attendance[0].rule, 'full');
  assert.equal(t.attendance[0].amount, 96774);
  assert.equal(t.net, 2000000 + 100000 - 96774 - 50000);

  assert.throws(() => employeeSettlement({ monthlySalary: 100, workingDays: 0 }), /workingDays/);
  assert.throws(() => employeeSettlement({ monthlySalary: 100000, workingDays: 25, deductions: [{ label: 'Advance', amount: 100001 }] }), /negative/);
  assert.equal(employeeSettlement({ monthlySalary: 100000, workingDays: 25, deductions: [{ label: 'Advance', amount: 100000 }] }).net, 0);
  assert.throws(() => employeeSettlement({ monthlySalary: 100, workingDays: 2.5 }), /workingDays/);
  assert.throws(() => employeeSettlement({ monthlySalary: 100, workingDays: 2, attendance: [{ label: 'x', days: 1, rule: 'quarter' }] }), /rule/);
  assert.throws(() => employeeSettlement({ monthlySalary: 100, workingDays: 2, attendance: [{ days: 1 }] }), /attendance\.0\.label/);
  assert.throws(() => employeeSettlement({ monthlySalary: 100, workingDays: 2, attendance: [{ label: 'x', days: 1.234 }] }), /2 decimals/);
});

test('ticketing settlement: revenue = sold × price, fee and GST in paise, charges deducted or for reference', () => {
  const tickets = [{ type: 'A', sold: 49, price: 39900 }, { type: 'B', sold: 57, price: 49900 }, { type: 'C', sold: 23, price: 29900 }];
  const s = ticketingSettlement({ tickets, feePercent: 1.5 });
  assert.deepEqual([s.sold, s.gross, s.fee, s.gst, s.charges, s.net], [129, 5487100, 82307, 14815, 97122, 5389978]);
  assert.equal(s.gstPercent, 18);
  const ref = ticketingSettlement({ tickets, feePercent: 1.5, deductCharges: false });
  assert.equal(ref.net, 5487100);
  const zero = ticketingSettlement({ tickets });
  assert.deepEqual([zero.fee, zero.gst, zero.net], [0, 0, 5487100]);
  assert.throws(() => ticketingSettlement({ tickets: [] }), /at least one/);
  assert.throws(() => ticketingSettlement({ tickets: [{ type: 'A', sold: 1, price: 10000 }], feePercent: 90 }), /negative/);
  assert.equal(ticketingSettlement({ tickets: [{ type: 'A', sold: 1, price: 10000 }], feePercent: 90, deductCharges: false }).net, 10000);
  assert.throws(() => ticketingSettlement({ tickets: [{ type: 'A', sold: 1.5, price: 100 }] }), /sold/);
  assert.throws(() => ticketingSettlement({ tickets: [{ sold: 1, price: 100 }] }), /type or an event/);
});

test('client settlement: GST on the fee, advance, expenses and total payable', () => {
  const s = clientSettlement({
    serviceFee: 1500000, advance: 1050000,
    expenses: [{ description: 'Travel', amount: 306650 }, { description: 'Meals', amount: 20000 }, { description: 'Meals', amount: 16000 },
      { description: 'Travel', amount: 311900 }, { description: 'Messages', amount: 30400 }],
  });
  assert.deepEqual([s.gst, s.serviceTotal, s.balance, s.expensesTotal, s.total], [270000, 1770000, 720000, 684950, 1404950]);
  assert.equal(clientSettlement({ serviceFee: 1000000, gstPercent: 0 }).total, 1000000);
  assert.throws(() => clientSettlement({ serviceFee: 100, advance: 1000 }), /negative/);
  assert.throws(() => clientSettlement({ serviceFee: 100, expenses: [{ amount: 5 }] }), /description/);
});

test('expense totals and detail rows', () => {
  const e = expenseTotals({ items: [{ particulars: 'Travel', amount: 600000 }, { particulars: 'Food', calculation: 'x', amount: 150000 }] });
  assert.equal(e.total, 750000);
  assert.equal(e.items[0].calculation, '');
  assert.throws(() => expenseTotals({ items: [] }), /at least one/);
  assert.deepEqual(detailRows([{ label: 'Bank', value: 'Example Bank' }, ['Branch', 'Main']], 'account'), [['Bank', 'Example Bank'], ['Branch', 'Main']]);
  assert.deepEqual(detailRows(undefined, 'account'), []);
  assert.throws(() => detailRows([{ label: 'Bank' }], 'account'), /account\.0/);
  assert.throws(() => detailRows('x', 'account'), /list/);
});
