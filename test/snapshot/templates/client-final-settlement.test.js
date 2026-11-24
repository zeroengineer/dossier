import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const CW = 595.28 - 75;
const PH = 841.89;
const ID = 'client-final-settlement';
const NUMBER = 'FSS/EISS/2026/001';
const find = (items, text, page) => items.find((i) => i.text === text && (page === undefined || i.page === page)) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('client final settlement: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, ID, { number: NUMBER });
  clearImageCache();
  const b = await renderFixture(ctx, ID, { number: NUMBER });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot(ID, a.pdf);
}));

test('client final settlement: legacy positions (DISCOVERY A8 §7b)', () => withExampleCtx(async (ctx) => {
  const { pdf, values, md } = await renderFixture(ctx, ID, { number: NUMBER });
  assert.equal(values.total, 1404950);
  const items = await extractItems(pdf);
  assert.deepEqual([...new Set(items.map((i) => i.page))], [1, 2]);
  const title = find(items, 'FINAL SETTLEMENT STATEMENT');
  assert.deepEqual([title.page, title.y, title.size, title.font], [1, 101, 16, 'Manrope-ExtraBold']);
  near(title.x + title.width / 2, ML + CW / 2, 'title centred');
  assert.equal(items.filter((i) => i.text === 'FINAL SETTLEMENT STATEMENT').length, 1, 'title on page 1 only');
  // Meta at rule 138 + 10, size 8.5; Issued To wraps over three lines (lineGap 3.5); right column label w65, value +70.
  const ev = find(items, 'Event:');
  assert.deepEqual([ev.x, ev.y, ev.size], [ML, 148, 8.5]);
  assert.equal(find(items, 'Issued To:').y, 169);
  assert.equal(find(items, 'Attn: Event Coordinator').x, ML + 65);
  const rightX = ML + CW / 2 - 10 + 20;
  const docNo = find(items, 'Doc No.:');
  near(docNo.x, rightX, 'right column');
  assert.equal(docNo.y, 148);
  const num = find(items, NUMBER);
  near(num.x, rightX + 70, 'number value');
  assert.equal(find(items, 'Date:').y, 148 + 18);
  // Section bars h20 with Bold 9.5 text at +5.5; table header Bold 9; rows auto height (pad 4, lineGap 3.5).
  const s1 = find(items, '1. EVENT DETAILS');
  assert.deepEqual([s1.x, s1.size, s1.font], [ML + 8, 9.5, 'Manrope-Bold']);
  const ph = find(items, 'PARTICULAR');
  assert.deepEqual([ph.x, ph.y, ph.size, ph.font], [ML + 8, s1.y - 5.5 + 28 + 4, 9, 'Manrope-Bold']);
  assert.equal(find(items, 'DETAILS').x, ML + 140 + 8);
  assert.equal(find(items, 'Event').font, 'Manrope-Bold');
  const fee = find(items, '15,000.00');
  near(fee.x + fee.width, ML + CW - 8, 'amount right edge');
  assert.equal(find(items, '(10,500.00)').font, 'Manrope-Bold');
  // Expenses start page 2 (legacy forced break), right below the letterhead.
  const s3 = find(items, '3. REIMBURSABLE EXPENSES');
  assert.equal(s3.page, 2);
  near(s3.y, 110 + 1.5 + 5.5, 'page 2 first section', 1);
  const total = find(items, '₹14,049.50');
  assert.deepEqual([total.size, total.font, total.page], [19, 'Manrope-ExtraBold', 2]);
  const label = find(items, 'Total Amount Payable to Acme Events Private Limited:');
  assert.equal(total.y, label.y + 18);
  const words = find(items, '(Rupees Fourteen Thousand Forty Nine and Fifty Paise Only)');
  assert.deepEqual([words.y, words.size, words.font], [label.y + 42, 9, 'Manrope-Medium']);
  const note = items.find((i) => i.text.startsWith('This statement is issued under the agreement'));
  assert.deepEqual([note.x, note.size], [ML + 10, 8.5]);
  // Footnote on the last page at PH - MB - 40.
  const foot = items.find((i) => i.text.startsWith('This document is the final settlement statement'));
  assert.equal(foot.page, 2);
  near(foot.y, PH - 39 - 40, 'footnote');
  assert.match(md, /\*\*Doc No\.:\*\* FSS\/EISS\/2026\/001/);
  assert.match(md, /\| \*\*Total Amount Payable\*\* \| \*\*14,049\.50\*\* \|/);
}));

test('client final settlement: no advance and no expenses; preview prints DRAFT', () => withExampleCtx(async (ctx) => {
  const input = { ...fixtureInput(ID), advance: undefined, expenses: undefined, agreementDate: undefined };
  const { pdf, values } = await renderFixture(ctx, ID, { input, draft: true, number: null });
  assert.equal(values.total, 1770000);
  const items = await extractItems(pdf);
  assert.ok(find(items, 'DRAFT'));
  assert.equal(items.some((i) => i.text === 'Advance Payment Received' || i.text === '3. REIMBURSABLE EXPENSES'), false);
  assert.equal(find(items, '4. FINAL SETTLEMENT SUMMARY').page, 2);
  assert.ok(find(items, '₹17,700.00'));
  assert.equal(items.some((i) => /agreement dated/.test(i.text)), false, 'agreement sentences need agreementDate');
}));
