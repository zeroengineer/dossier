import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const CW = 595.28 - 75;
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('employee final settlement: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'employee-final-settlement', { number: null });
  clearImageCache();
  const b = await renderFixture(ctx, 'employee-final-settlement', { number: null });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('employee-final-settlement', a.pdf);
}));

test('employee final settlement: legacy positions (DISCOVERY A8 §6b)', () => withExampleCtx(async (ctx) => {
  const { pdf, md, values } = await renderFixture(ctx, 'employee-final-settlement', { number: null });
  assert.equal(values.total, 1080000);
  const items = await extractItems(pdf);
  assert.deepEqual([...new Set(items.map((i) => i.page))], [1]);
  // Letterhead rule at ≈85: title at rule + 16, meta grid at rule + 54, rows 24 apart.
  const title = find(items, 'FINAL SETTLEMENT STATEMENT');
  assert.deepEqual([title.y, title.size, title.font], [101, 14.5, 'Manrope-ExtraBold']);
  near(title.x + title.width / 2, ML + CW / 2, 'title centred');
  const name = find(items, 'Employee Name:');
  assert.deepEqual([name.x, name.y, name.size, name.font], [ML, 139, 9.5, 'Manrope-Bold']);
  assert.deepEqual([find(items, 'Jordan Placeholder').x, find(items, 'Jordan Placeholder').font], [ML + 115, 'Manrope-Medium']);
  assert.deepEqual([find(items, 'Department:').x, find(items, 'Operations').x], [ML + 305, ML + 390]);
  assert.equal(find(items, 'Designation:').y, 163);
  assert.equal(find(items, 'Settlement Period:').y, 187);
  assert.ok(find(items, '1 October 2026 to 31 October 2026'));
  assert.equal(items.some((i) => i.text === 'Reference:'), false, 'unnumbered: no reference cell');
  // Tables: header h28 (title +8.5), rows h26 (text +7.5), values right-aligned at ML + CW - 10.
  const salary = find(items, 'Salary Details');
  assert.deepEqual([salary.x, salary.y, salary.size], [ML + 10, 139 + 72 + 14 + 8.5, 10]);
  const monthly = find(items, '₹20,000');
  assert.deepEqual([monthly.y, monthly.font], [225 + 28 + 7.5, 'Manrope-Bold']);
  near(monthly.x + monthly.width, ML + CW - 10, 'value right edge');
  assert.ok(find(items, '• Per Day Salary (₹20,000 ÷ 25)'));
  assert.equal(find(items, '₹800').font, 'Manrope-SemiBold');
  const deductions = find(items, 'Deductions');
  assert.equal(deductions.y, 225 + 28 + 4 * 26 + 20 + 8.5);
  assert.ok(find(items, '• Late arrival (16 days × half-day salary ₹400)'));
  assert.equal(find(items, 'Total Deductions').font, 'Manrope-Bold');
  assert.equal(find(items, '– ₹9,200.00').font, 'Manrope-SemiBold');
  const net = find(items, '₹10,800.00');
  assert.deepEqual([net.size, net.font], [12, 'Manrope-Bold']);
  const netLabel = find(items, 'Net Salary Payable');
  assert.equal(net.y, netLabel.y - 10 + 18);
  assert.equal(find(items, '(₹20,000 – ₹9,200 deductions)').y, netLabel.y - 10 + 28);
  // Signature row: line at 755, labels +9, date -16, signature image h46 centred above the first line.
  assert.equal(find(items, 'Authorized Signatory').y, 764);
  assert.equal(find(items, 'Employee Signature').y, 764);
  const date = find(items, '9 November 2026');
  assert.deepEqual([date.y, date.size], [739, 10]);
  near(date.x + date.width / 2, ML + CW / 2, 'date centred');
  const imgs = (await extractImages(pdf)).filter((im) => im.y > 100);
  assert.equal(imgs.length, 1);
  assert.deepEqual([imgs[0].y, imgs[0].height], [755 - 46 - 3, 46]);
  near(imgs[0].x + imgs[0].width / 2, ML + 75, 'signature centred over the first line');
  assert.ok(find(items, 'Confidential'));
  assert.match(md, /\*\*Net Salary Payable:\*\* \*\*₹10,800\.00\*\*/);
}));

test('employee final settlement: other deductions, additions, declaration and a long list move to a second page', () => withExampleCtx(async (ctx) => {
  const input = {
    ...fixtureInput('employee-final-settlement'),
    deductions: [{ label: 'Salary advance', amount: 1000 }],
    additions: [{ label: 'Travel reimbursement', amount: '1,250.50' }],
    declaration: 'The amounts above have been checked and are payable as stated.',
  };
  const { pdf, values } = await renderFixture(ctx, 'employee-final-settlement', { input, number: null });
  assert.equal(values.total, 2000000 + 125050 - 920000 - 100000);
  const items = await extractItems(pdf);
  assert.ok(find(items, '• Salary advance'));
  assert.ok(find(items, '• Add: Travel reimbursement'));
  assert.ok(find(items, '₹11,050.50'));
  assert.ok(find(items, 'The amounts above have been checked and are payable as stated.'));

  const many = { ...fixtureInput('employee-final-settlement'), attendance: Array.from({ length: 14 }, (_, i) => ({ label: `Day ${i + 1}`, days: 0.5, rule: 'full' })) };
  const long = await extractItems((await renderFixture(ctx, 'employee-final-settlement', { input: many, number: null })).pdf);
  assert.deepEqual([...new Set(long.map((i) => i.page))], [1, 2]);
  assert.equal(find(long, 'Authorized Signatory').page, 2);
  assert.ok(long.filter((i) => i.page === 1).every((i) => i.y < 755 - 46 - 3 || i.y > 800), 'nothing on page 1 runs into the signature zone');
}));

test('employee final settlement: bad values are field errors', () => withExampleCtx(async (ctx) => {
  const { getTemplate } = await import('../../../src/services/templates.js');
  const { resolveTemplateFields } = await import('../../../src/services/fields.js');
  const t = await getTemplate(ctx, 'employee-final-settlement');
  const r = resolveTemplateFields(ctx, t, { ...fixtureInput('employee-final-settlement'), workingDays: 0 }, { brandId: 'acme' });
  assert.deepEqual(r.errors.map((e) => e.name), ['settlement']);
  assert.match(r.errors[0].message, /workingDays/);
}));
