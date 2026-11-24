import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const NUMBER = 'ACM/HR/2026/EXP-002';
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);

test('experience certificate: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'experience-certificate', { number: NUMBER });
  clearImageCache();
  const b = await renderFixture(ctx, 'experience-certificate', { number: NUMBER });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('experience-certificate', a.pdf);
}));

test('experience certificate: legacy positions (DISCOVERY A8 §4), no-seal variant', () => withExampleCtx(async (ctx) => {
  const { pdf, md } = await renderFixture(ctx, 'experience-certificate', { number: NUMBER });
  const items = await extractItems(pdf);
  assert.deepEqual([find(items, `Ref: ${NUMBER}`).x, find(items, `Ref: ${NUMBER}`).y], [ML, 135]);
  assert.equal(find(items, 'EXPERIENCE CERTIFICATE').size, 14);
  assert.ok(find(items, 'Events Department'));
  // seal: false -> no seal image; image at +16 and the name 10 below it (legacy no-seal certificate).
  const forLine = find(items, 'For Acme Events Private Limited');
  const imgs = (await extractImages(pdf)).filter((im) => im.y > 100);
  assert.deepEqual(imgs.map((im) => [im.x, im.y, im.height]), [[ML, forLine.y + 16, 50]]);
  assert.equal(find(items, 'Sam Sample').y, forLine.y + 16 + 50 + 10);
  assert.ok(find(items, 'Page 1 of 1'));
  assert.match(md, /\*\*Mr\. Jordan Placeholder\*\*/);
}));
