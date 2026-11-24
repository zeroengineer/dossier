import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const PW = 595.28;
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('receipt: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'receipt');
  clearImageCache();
  const b = await renderFixture(ctx, 'receipt');
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('receipt', a.pdf);
}));

test('receipt: legacy label positions (DISCOVERY A8 §1)', () => withExampleCtx(async (ctx) => {
  const { pdf, html, md } = await renderFixture(ctx, 'receipt');
  const items = await extractItems(pdf);
  assert.equal(find(items, 'PAYMENT RECEIPT').y, 36);
  const label = find(items, 'RECEIPT NO:');
  near(label.x + label.width, PW - 40 - 100, 'number label ends CW-100 in', 1.5);
  assert.equal(find(items, 'RECEIVED FROM').y, 114);
  assert.equal(find(items, 'RECEIVED BY').y, 114);
  // Columns [32, 243, 120, 120.28], size 8, S.NO and AMOUNT padded 6; rows h34; long descriptions start at +6.
  const sno = find(items, 'S.NO');
  assert.deepEqual([sno.x, sno.size], [46, 8]);
  assert.equal(find(items, 'DESCRIPTION').x, 72);
  near(find(items, 'AMOUNT').x + find(items, 'AMOUNT').width, PW - 40 - 6, 'amount header right-aligned 6 in');
  const rowTop = sno.y - 7 + 22;
  assert.equal(find(items, '1').y, rowTop + 12);
  assert.equal(find(items, 'Professional service fee – advance payment').y, rowTop + 6, '> 40 characters: +6');
  assert.equal(find(items, 'Professional service fee – balance').y, rowTop + 34 + 12);
  assert.ok(find(items, 'Debit Note ACM-DN-2026-0003'));
  // Acknowledgement panel replaces the bank details; summary +25 below the table.
  assert.equal(items.some((i) => i.text === 'BANK DETAILS'), false);
  const ack = find(items, 'ACKNOWLEDGEMENT OF PAYMENT');
  assert.deepEqual([ack.x, ack.y, ack.size], [50, rowTop + 3 * 34 + 25 + 10, 8.5]);
  assert.match(items.filter((i) => i.size === 8 && i.x === 50).map((i) => i.text).join(' '), /₹24,549\.50 \(Rupees Twenty Four Thousand/);
  const subtotal = find(items, 'Subtotal Received');
  assert.equal(subtotal.y, rowTop + 3 * 34 + 25);
  assert.equal(find(items, 'Total Received').y, subtotal.y + 23);
  // Signatory rule at max(y after total + 35, summaryY + 105).
  assert.equal(find(items, 'FOR ACME EVENTS PRIVATE LIMITED').y, subtotal.y + 105 + 15);
  assert.ok(html.includes('ACKNOWLEDGEMENT OF PAYMENT'));
  assert.match(md, /## ACKNOWLEDGEMENT OF PAYMENT/);
}));

test('receipt: acknowledgement text and title come from the fields when given', () => withExampleCtx(async (ctx) => {
  const input = { ...fixtureInput('receipt'), acknowledgement: { title: 'FINAL SETTLEMENT', text: 'Paid in full by {party}: {amount}.' } };
  const items = await extractItems((await renderFixture(ctx, 'receipt', { input })).pdf);
  assert.ok(find(items, 'FINAL SETTLEMENT'));
  assert.ok(find(items, 'Paid in full by Example Institute of Sample Studies: ₹24,549.50.'));
}));
