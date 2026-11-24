import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const CW = 595.28 - 75;
const ID = 'ticketing-settlement-statement';
const find = (items, text, page) => items.find((i) => i.text === text && (page === undefined || i.page === page)) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('ticketing statement: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, ID, { number: null });
  clearImageCache();
  const b = await renderFixture(ctx, ID, { number: null });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot(ID, a.pdf);
}));

test('ticketing statement: legacy positions; title and meta repeated on every page (DISCOVERY A8 §7)', () => withExampleCtx(async (ctx) => {
  const { pdf, values, md } = await renderFixture(ctx, ID, { number: null });
  assert.deepEqual([values.settlement.gross, values.settlement.fee, values.settlement.gst, values.total], [5487100, 82307, 14815, 5389978]);
  const items = await extractItems(pdf);
  const pages = [...new Set(items.map((i) => i.page))];
  assert.deepEqual(pages, [1, 2]);
  const rightX = ML + CW / 2 - 10 + 20;
  for (const p of pages) {
    const head = items.filter((i) => i.y < 230);
    const title = find(head, 'TICKETING & SETTLEMENT STATEMENT', p);
    assert.deepEqual([title.y, title.size, title.font], [101, 16.5, 'Manrope-ExtraBold']);
    near(title.x + title.width / 2, ML + CW / 2, 'title centred');
    const ev = find(head, 'Event:', p);
    assert.deepEqual([ev.x, ev.y, ev.size, ev.font], [ML, 144, 10, 'Manrope-Regular']);
    assert.deepEqual([find(head, 'Sample Annual Meet 2026', p).x, find(head, 'Sample Annual Meet 2026', p).font], [ML + 65, 'Manrope-Medium']);
    assert.equal(find(head, 'Issued To:', p).y, 164);
    assert.equal(find(head, 'ACME EVENTS PRIVATE LIMITED', p).y, 184);
    const date = find(head, 'Date:', p);
    near(date.x, rightX, 'right column');
    assert.equal(date.y, 144);
    const pageNo = find(head, `Page ${p} of 2`, p);
    assert.equal(find(head, 'Page No.:', p).y, 144 + 19);
    near(pageNo.x, rightX + 65, 'page number value');
    assert.equal(items.some((i) => i.text === 'Doc No.:'), false, 'unnumbered: no Doc No.');
  }
  // Content starts at MT + CP + 125 = 237; section bar h24 with the text at +7 after moveDown(0.2).
  const s1 = find(items, '1. TICKET SALES SUMMARY');
  assert.deepEqual([s1.x, s1.size, s1.font], [ML + 8, 10, 'Manrope-Bold']);
  near(s1.y, 237 + 2 + 7, 'first section bar', 1);
  const head = find(items, 'TICKET TYPE');
  assert.deepEqual([head.x, head.y, head.size, head.font], [ML + 8, s1.y - 7 + 24 + 12 + 10, 8, 'Manrope-Bold']);
  const r1 = find(items, 'Members');
  assert.deepEqual([r1.y, r1.size], [head.y - 10 + 26 + 4 + 8, 9]);
  assert.equal(find(items, 'Non-members').y, r1.y + 25);
  const revenue = find(items, '₹19,551.00');
  near(revenue.x + revenue.width, ML + CW - 8, 'revenue right edge');
  const total = find(items, 'Total');
  assert.deepEqual([total.y, total.font], [r1.y + 3 * 25 + 4, 'Manrope-Bold']);
  assert.ok(find(items, '₹54,871.00'));
  const fee = find(items, 'Platform Fee (1.5%)');
  assert.deepEqual([fee.x, fee.size], [ML + 3 + 14, 11]);
  assert.equal(find(items, 'Base Fee:').y, fee.y + 24);
  assert.equal(find(items, 'GST @18%:').y, fee.y + 44);
  assert.ok(find(items, '₹823.07'));
  assert.ok(find(items, '₹148.15'));
  assert.equal(find(items, 'Total:').size, 10.5);
  const net = find(items, '₹53,899.78');
  assert.deepEqual([net.size, net.font], [20, 'Manrope-ExtraBold']);
  assert.equal(find(items, 'Net Settlement Amount for the Organisers of Sample Annual Meet 2026:').y, net.y - 20);
  // Acknowledgement on page 2 (the legacy 200 pt keep-together), signature fields 42 apart.
  const ack = find(items, '4. ACKNOWLEDGEMENT');
  assert.equal(ack.page, 2);
  const nameField = find(items, 'Name:');
  assert.equal(find(items, 'Designation:').y, nameField.y + 42);
  assert.equal(find(items, 'Signature & Seal:').y, nameField.y + 84);
  assert.match(md, /\| \*\*Total\*\* \| \*\*129\*\* \|  \| \*\*₹54,871\.00\*\* \|/);
}));

test('ticketing statement: event column, grouped shading, charges for reference, tighter fields', () => withExampleCtx(async (ctx) => {
  const input = {
    ...fixtureInput(ID),
    tickets: [
      { event: 'Workshop A', type: 'General', sold: 46, price: 249 },
      { event: 'Contest B', type: 'Team of 2', sold: 2, price: 298 },
      { type: 'Team of 3', sold: 2, price: 447 },
      { event: 'Talk C', type: 'General', sold: 2, price: 50 },
    ],
    deductCharges: false,
  };
  const { pdf, values } = await renderFixture(ctx, ID, { input, number: null });
  assert.equal(values.total, values.settlement.gross, 'charges not deducted');
  const items = await extractItems(pdf);
  assert.deepEqual([find(items, 'EVENT').x, find(items, 'TICKET TYPE').x], [ML + 8, ML + 175 + 8]);
  const sold = find(items, 'TICKETS SOLD');
  near(sold.x + sold.width, ML + 175 + 95 + 80 - 8, 'sold column right edge');
  assert.equal(find(items, 'Total').x, ML + 8, 'total label in the first (event) column');
  assert.ok(find(items, 'Team of 3'));
}));

test('ticketing statement: a numbered brand prints Doc No.; brand params set the field spacing', () => withExampleCtx(async (ctx) => {
  const brand = ctx.ws.brands.get('acme');
  const params = { acknowledgement: { text: 'Confirmed by the organisers of {event}.', fields: ['Signed by:', 'On:'], fieldSpacing: 24, breakMin: 110 } };
  ctx.ws.brands.set('acme', { ...brand, templateParams: { [ID]: params } });
  try {
    const { pdf } = await renderFixture(ctx, ID, { number: 'ACM-DOC-2026-0007' });
    const items = await extractItems(pdf);
    for (const p of [1, 2]) {
      assert.equal(find(items, 'Doc No.:', p).y, 144);
      assert.ok(find(items, 'ACM-DOC-2026-0007', p));
      assert.equal(find(items, 'Date:', p).y, 144 + 19);
      assert.equal(find(items, 'Page No.:', p).y, 144 + 38);
    }
    assert.ok(find(items, 'Confirmed by the organisers of Sample Annual Meet 2026.'));
    assert.equal(find(items, 'On:').y - find(items, 'Signed by:').y, 24);
  } finally {
    ctx.ws.brands.set('acme', brand);
  }
}));
