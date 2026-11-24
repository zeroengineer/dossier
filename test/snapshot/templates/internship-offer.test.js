import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const RIGHT = 595.28 - 37.5;
const find = (items, text, page) => items.find((i) => i.text === text && (page === undefined || i.page === page)) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('internship offer: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'internship-offer', { number: null });
  clearImageCache();
  const b = await renderFixture(ctx, 'internship-offer', { number: null });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('internship-offer', a.pdf);
}));

test('internship offer: legacy positions (DISCOVERY A8 §3), no annexure, no seal', () => withExampleCtx(async (ctx) => {
  const { pdf, md } = await renderFixture(ctx, 'internship-offer', { number: null });
  const items = await extractItems(pdf);
  const date = find(items, 'Date: 3 July 2026');
  assert.equal(date.y, 130);
  near(date.x + date.width, RIGHT, 'date right edge');
  assert.equal(find(items, 'To,').y, 155);
  const subject = find(items, 'SUBJECT: OFFER OF INTERNSHIP – SOFTWARE DEVELOPER INTERN');
  near(subject.x + subject.width / 2, ML + (RIGHT - ML) / 2, 'subject centred');
  assert.ok(find(items, 'Dear Ms. Riley,'));
  assert.ok(find(items, '₹10,000 (Rupees Ten Thousand Only)'));
  const pages = Math.max(...items.map((i) => i.page));
  assert.equal(find(items, 'TERMS OF INTERNSHIP').page, 2);
  assert.equal(find(items, 'ACCEPTANCE OF OFFER').page, pages);
  assert.equal(items.some((i) => /ANNEXURE/.test(i.text)), false);
  // Body lineGap 4: consecutive lines of one paragraph are 14.343 + 4 apart (rounded to 0.5 in the extraction).
  const p1 = items.filter((i) => i.page === 2 && i.size === 10.5 && i.x === ML).map((i) => i.y);
  near(p1[1] - p1[0], 18.34, 'line step', 0.5);
  // No seal: image at +16, name +10 below the image, title +14, "Authorized Signatory" +26.
  const forLine = find(items, 'For Acme Events Private Limited', pages);
  const imgs = (await extractImages(pdf)).filter((im) => im.page === pages && im.y > 100);
  assert.deepEqual(imgs.map((im) => [im.x, im.y, im.height]), [[ML, forLine.y + 16, 55]]);
  const name = find(items, 'Sam Sample', pages);
  assert.equal(name.y, forLine.y + 16 + 55 + 10);
  assert.equal(find(items, 'Authorized Signatory', pages).y, name.y + 26);
  assert.match(md, /## 6\. Stipend/);
}));

test('internship offer: an unpaid internship leaves out the stipend paragraph and clause', () => withExampleCtx(async (ctx) => {
  const { stipend, ...input } = fixtureInput('internship-offer');
  assert.ok(stipend);
  const { pdf, md } = await renderFixture(ctx, 'internship-offer', { input, number: null });
  const text = (await extractItems(pdf)).map((i) => i.text).join(' ');
  assert.doesNotMatch(text, /stipend|Stipend/);
  assert.match(md, /## 6\. Leave/);
  assert.match(md, /## 14\. Governing Law/);
}));
