import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const PW = 595.28;
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('debit note: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'debit-note');
  clearImageCache();
  const b = await renderFixture(ctx, 'debit-note');
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('debit-note', a.pdf);
}));

test('debit note: legacy label positions (DISCOVERY A8 §1)', () => withExampleCtx(async (ctx) => {
  const { pdf, values, html, md } = await renderFixture(ctx, 'debit-note');
  const items = await extractItems(pdf);
  const title = find(items, 'DEBIT NOTE');
  assert.deepEqual([title.y, title.size], [36, 22]);
  const label = find(items, 'DEBIT NOTE NO:');
  near(label.x + label.width, PW - 40 - 100, 'number label ends CW-100 in', 1.5);
  assert.deepEqual([find(items, 'DEBIT TO').x, find(items, 'DEBIT TO').y], [40, 114]);
  assert.equal(find(items, 'FROM').y, 114);
  // Rows h24, text at +7, no tax lines, em dash when an item has no code.
  const sno = find(items, 'S.NO');
  const rows = ['1', '2', '3', '4', '5'].map((n) => items.find((i) => i.text === n && i.x === 48));
  assert.equal(rows[0].y, sno.y - 7 + 22 + 7);
  rows.slice(1).forEach((r, i) => assert.equal(r.y - rows[i].y, 24, `row ${i + 2} pitch`));
  assert.equal(items.filter((i) => i.text === '—').length, 5);
  const subtotal = find(items, 'Subtotal');
  assert.equal(subtotal.y, rows[4].y - 7 + 24 + 15);
  assert.equal(find(items, 'Total Debit Note').y, subtotal.y + 18 + 4 + 1);
  assert.equal(items.some((i) => /GST/.test(i.text) && i.x > 300 && i.y > subtotal.y - 1), false, 'no tax lines');
  assert.ok(find(items, '₹ 6,849.50'));
  assert.equal(values.total, 684950);
  assert.ok(find(items, 'BANK DETAILS'));
  assert.match(find(items, 'Declaration') && items.find((i) => i.text.startsWith('We declare')).text, /debit note/);
  assert.ok(html.includes('Total Debit Note'));
  assert.match(md, /^# DEBIT NOTE\n/);
}));
