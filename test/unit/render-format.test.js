import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormatter, indianWords } from '../../src/render/pdf/format.js';
import { WorkspaceSchema } from '../../src/workspace/schemas.js';

const fmt = createFormatter(WorkspaceSchema.parse({ name: 'x', defaultBrand: 'acme' }).locale);

test('money: invoice style with a space, letter style without, en-IN grouping', () => {
  assert.equal(fmt.money(1050000, { space: true }), '₹ 10,500.00');
  assert.equal(fmt.money(12000000), '₹1,20,000.00');
  assert.equal(fmt.money(12000000, { decimals: 0 }), '₹1,20,000');
  assert.equal(fmt.money(0, { space: true }), '₹ 0.00');
  assert.equal(fmt.money(5), '₹0.05');
  assert.equal(fmt.money(-150), '-₹1.50');
  assert.equal(fmt.money(1234567890123), '₹12,34,56,78,901.23');
  assert.equal(fmt.number(1000000, { decimals: 0 }), '10,000');
  assert.throws(() => fmt.money(10.5), /integer number of minor units/);
});

test('money uses the workspace currency symbol and number locale', () => {
  const us = createFormatter({ currencySymbol: '$', numberLocale: 'en-US' });
  assert.equal(us.money(12000000, { space: true }), '$ 120,000.00');
});

test('date: short, long and us styles from ISO dates, taken literally', () => {
  assert.equal(fmt.date('2026-08-29', 'short'), '29/08/2026');
  assert.equal(fmt.date('2026-08-29', 'long'), '29 August 2026');
  assert.equal(fmt.date('2026-10-29', 'us'), 'October 29, 2026');
  assert.equal(fmt.date('2026-08-01T23:30:00+05:30', 'short'), '01/08/2026');
  assert.equal(fmt.date(new Date(2024, 9, 31), 'Do MMMM YYYY'), '31st October 2024');
  assert.equal(fmt.date('2024-10-12', 'Do MMM'), '12th Oct');
  assert.equal(fmt.date('2024-10-22', 'Do'), '22nd');
  assert.equal(fmt.date('2026-08-29'), '29 August 2026');
  assert.throws(() => fmt.date('2026-02-30', 'short'), /not a calendar date/);
  assert.throws(() => fmt.date('29/08/2026', 'short'), /expected YYYY-MM-DD/);
});

test('date styles come from the workspace locale', () => {
  const f = createFormatter({ dateFormats: { short: 'YYYY-MM-DD' } });
  assert.equal(f.date('2026-08-29', 'short'), '2026-08-29');
  assert.equal(f.date('2026-08-29', 'long'), '29 August 2026');
});

test('amountInWords: Indian grouping, zero, paise, crore', () => {
  assert.equal(fmt.amountInWords(0), 'Rupees Zero Only');
  assert.equal(fmt.amountInWords(12000000), 'Rupees One Lakh Twenty Thousand Only');
  assert.equal(fmt.amountInWords(1050), 'Rupees Ten and Fifty Paise Only');
  assert.equal(fmt.amountInWords(50), 'Fifty Paise Only');
  assert.equal(fmt.amountInWords(1), 'One Paise Only');
  assert.equal(fmt.amountInWords(1050000), 'Rupees Ten Thousand Five Hundred Only');
  assert.equal(fmt.amountInWords(10000001), 'Rupees One Lakh and One Paise Only');
  assert.equal(fmt.amountInWords(12345678900), 'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only');
  assert.equal(fmt.amountInWords(100000000000 * 100), 'Rupees Ten Thousand Crore Only');
  assert.equal(fmt.amountInWords(1e14), 'Rupees One Lakh Crore Only');
  assert.equal(indianWords(115), 'One Hundred Fifteen');
  assert.equal(indianWords(1000), 'One Thousand');
  assert.equal(indianWords(99999), 'Ninety Nine Thousand Nine Hundred Ninety Nine');
  assert.throws(() => fmt.amountInWords(-1), /negative/);
});

test('amountInWords currency words are configurable', () => {
  const f = createFormatter({ currencyWords: { major: 'Dollars', minor: 'Cents', suffix: '' } });
  assert.equal(f.amountInWords(1025), 'Dollars Ten and Twenty Five Cents');
  const parsed = WorkspaceSchema.parse({ name: 'x', defaultBrand: 'a', locale: { currencyWords: { major: 'Dirhams' } } });
  assert.deepEqual(parsed.locale.currencyWords, { major: 'Dirhams', minor: 'Paise', suffix: 'Only' });
});
