import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const PW = 595.28;
const ML = 40;
const CW = PW - 80;
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const rightEdge = (i) => i.x + i.width;
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('invoice: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'invoice');
  clearImageCache();
  const b = await renderFixture(ctx, 'invoice');
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('invoice', a.pdf);
}));

test('invoice: legacy label positions (DISCOVERY A8 §1)', () => withExampleCtx(async (ctx) => {
  const { pdf, values } = await renderFixture(ctx, 'invoice');
  const items = await extractItems(pdf);
  assert.equal(new Set(items.map((i) => i.page)).size, 1, 'single page');

  const title = find(items, 'INVOICE');
  assert.deepEqual([title.y, title.size, title.font], [36, 22, 'Manrope-ExtraBold']);
  near(rightEdge(title), PW - 40, 'title right-aligned');
  const noLabel = find(items, 'INVOICE NO:');
  assert.deepEqual([noLabel.y, noLabel.size, noLabel.font], [66, 8.5, 'Manrope-SemiBold']);
  near(rightEdge(noLabel), PW - 40 - 80, 'number label ends CW-80 in', 1.5);
  assert.equal(find(items, 'ACM-2026-0001').font, 'Manrope-Bold');
  const date = find(items, '14/07/2026');
  assert.deepEqual([date.y, date.font], [79, 'Manrope-Medium']);

  const billTo = find(items, 'BILL TO');
  assert.deepEqual([billTo.x, billTo.y, billTo.size, billTo.font], [ML, 114, 9.5, 'Manrope-Bold']);
  assert.equal(find(items, 'Example Institute of Sample Studies').y, 129);
  const from = find(items, 'FROM');
  assert.deepEqual([from.x, from.y], [ML + CW / 2 - 10 + 20, 114].map((v) => Math.round(v * 2) / 2));
  assert.equal(find(items, 'ACME EVENTS PRIVATE LIMITED').y, 129);
  for (const label of ['GSTIN:', 'Phone:', 'Email:', 'Website:']) assert.equal(find(items, label).font, 'Manrope-SemiBold');
  assert.equal(find(items, '00AAAAA0000A0Z0').font, 'Manrope-Medium');
  assert.equal(find(items, 'billing@example.com').size, 8, 'billing contact email');
  assert.ok(find(items, 'www.example.com'), 'website falls back to the default contact');

  // Table: header h22 at rule+15 with text at +7; first row text at +12 below the header.
  const sno = find(items, 'S.NO');
  assert.deepEqual([sno.x, sno.size, sno.font], [ML + 8, 8.5, 'Manrope-Bold']);
  assert.equal(find(items, 'DESCRIPTION').x, ML + 35);
  const first = items.find((i) => i.text.startsWith('Event registration'));
  assert.equal(first.y, sno.y - 7 + 22 + 12);
  assert.equal(first.font, 'Manrope-Medium');
  assert.equal(find(items, '998596').y, first.y, 'HSN from brand.tax.defaultHsn');
  near(rightEdge(find(items, '₹ 12,500.00')), PW - 40 - 8, 'amount right-aligned 8 in');
  // Auto row height: max(44, description height + 24); the 4-line description is taller than 44.
  const second = find(items, 'On-site technical support');
  near(second.y - first.y, 4 * (8.5 * 1.366 + 1.5) + 24, 'auto row height (pdfkit adds lineGap after every line)', 1);

  // Summary: calc rows h18 at PW-MR-200, odd paisa on the last tax line, total pill.
  const subtotal = find(items, 'Subtotal');
  assert.equal(subtotal.x, 355.5);
  assert.equal(find(items, 'BANK DETAILS').y, subtotal.y);
  assert.equal(find(items, 'CGST (9%)').y, subtotal.y + 18);
  assert.equal(find(items, 'SGST (9%)').y, subtotal.y + 36);
  assert.ok(find(items, '₹ 1,367.46') && find(items, '₹ 1,367.47'));
  const total = find(items, 'Total Invoice');
  assert.deepEqual([total.y, total.size, total.font], [subtotal.y + 36 + 18 + 4 + 1, 9.5, 'Manrope-Bold']);
  assert.ok(find(items, '₹ 17,928.98'));
  assert.equal(values.total, 1792898);
  assert.deepEqual(values.totals.taxes.map((t) => t.amount), [136746, 136747]);
  assert.equal(find(items, 'Account Name:').y, subtotal.y + 15);

  // Signatory and bottom strip.
  const forLine = find(items, 'FOR ACME EVENTS PRIVATE LIMITED');
  assert.deepEqual([forLine.size, forLine.font], [8, 'Manrope-Bold']);
  near(rightEdge(forLine), PW - 40, 'for line right-aligned');
  const name = find(items, 'ALEX EXAMPLE');
  assert.equal(name.y, forLine.y + 60);
  assert.equal(find(items, 'CHIEF OPERATING OFFICER').y, name.y + 12);
  const decl = find(items, 'Declaration');
  assert.deepEqual([decl.x, decl.y], [ML, 747]);
  const thanks = find(items, 'THANK YOU FOR YOUR BUSINESS');
  assert.equal(thanks.y, 792);
  near(thanks.x + thanks.width / 2, PW / 2, 'thank-you centred', 1);
}));

test('invoice: fixed row height, IGST, Bold description; bad row height and bank account are field errors', () => withExampleCtx(async (ctx) => {
  const input = { ...fixtureInput('invoice'), rowHeight: 105, taxMode: 'igst', descriptionWeight: 'Bold' };
  const { pdf, values } = await renderFixture(ctx, 'invoice', { input });
  const items = await extractItems(pdf);
  const first = items.find((i) => i.text.startsWith('Event registration'));
  assert.equal(first.font, 'Manrope-Bold');
  assert.equal(find(items, 'On-site technical support').y - first.y, 105);
  assert.ok(find(items, 'IGST @ 18%'));
  assert.equal(items.some((i) => i.text.startsWith('CGST')), false);
  assert.deepEqual(values.totals.taxes.map((t) => t.amount), [273493]);
  const bad = await withExampleCtx(async (c) => {
    const { getTemplate } = await import('../../../src/services/templates.js');
    const { resolveTemplateFields } = await import('../../../src/services/fields.js');
    return resolveTemplateFields(c, await getTemplate(c, 'invoice'), { ...fixtureInput('invoice'), rowHeight: 'tall', bankAccount: 'nope' }, { brandId: 'acme' });
  });
  assert.deepEqual(bad.errors.map((e) => e.name).sort(), ['bank', 'layout']);
}));

test('invoice: preview prints DRAFT in place of the number; HTML and Markdown carry the same content', () => withExampleCtx(async (ctx) => {
  const { pdf, html, md } = await renderFixture(ctx, 'invoice', { draft: true });
  const items = await extractItems(pdf);
  assert.ok(find(items, 'DRAFT'));
  assert.equal(items.some((i) => i.text === 'ACM-2026-0001'), false);
  const final = await renderFixture(ctx, 'invoice');
  assert.match(final.html, /<!DOCTYPE html>/);
  assert.match(final.html, /@font-face/);
  assert.match(final.html, /font-size: 22pt/);
  for (const s of ['INVOICE NO: ', 'ACM-2026-0001', 'BILL TO', 'ACME EVENTS PRIVATE LIMITED', '₹ 17,928.98', 'SGST (9%)', 'BANK DETAILS', 'ALEX EXAMPLE', 'THANK YOU FOR YOUR BUSINESS']) {
    assert.ok(final.html.includes(s), `html has ${s}`);
  }
  assert.match(final.md, /^# INVOICE\n/);
  assert.match(final.md, /\| \*\*Total Invoice\*\* \|/);
  assert.match(final.md, /\*\*FOR ACME EVENTS PRIVATE LIMITED\*\*/);
  assert.match(md, /DRAFT/);
  assert.match(html, /DRAFT/);
}));
