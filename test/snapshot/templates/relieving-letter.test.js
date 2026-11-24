import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const RIGHT = 595.28 - 37.5;
const NUMBER = 'ACM/HR/2026/EXP-003';
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('relieving letter: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'relieving-letter', { number: NUMBER });
  clearImageCache();
  const b = await renderFixture(ctx, 'relieving-letter', { number: NUMBER });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('relieving-letter', a.pdf);
}));

test('relieving letter: certificate layout with ref/date line, title, body and sealed signature', () => withExampleCtx(async (ctx) => {
  const { pdf, md } = await renderFixture(ctx, 'relieving-letter', { number: NUMBER });
  const items = await extractItems(pdf);
  assert.deepEqual([...new Set(items.map((i) => i.page))], [1]);
  const ref = find(items, `Ref: ${NUMBER}`);
  assert.deepEqual([ref.x, ref.y, ref.size], [ML, 135, 9.5]);
  const date = find(items, 'Date: 24 February 2026');
  near(date.x + date.width, RIGHT, 'date right edge');
  const title = find(items, 'RELIEVING LETTER');
  assert.deepEqual([title.size, title.font], [14, 'Manrope-ExtraBold']);
  near(title.x + title.width / 2, ML + (RIGHT - ML) / 2, 'title centred');
  assert.ok(find(items, 'To Whom It May Concern,'));
  assert.ok(find(items, 'Jordan resigned from the position voluntarily, and the resignation has been accepted.'));
  const forLine = find(items, 'For Acme Events Private Limited');
  const imgs = (await extractImages(pdf)).filter((im) => im.y > 100);
  assert.equal(imgs.length, 2, 'signature and seal');
  assert.equal(find(items, 'Sam Sample').y, forLine.y + 24 + 72);
  assert.equal(items.some((i) => i.text === 'Confidential'), false);
  assert.match(md, /# RELIEVING LETTER/);
  assert.match(md, /\*\*24 February 2026\*\*/);
}));
