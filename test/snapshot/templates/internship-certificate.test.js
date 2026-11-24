import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const RIGHT = 595.28 - 37.5;
const NUMBER = 'ACM/HR/2026/EXP-001';
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('internship certificate: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'internship-certificate', { number: NUMBER });
  clearImageCache();
  const b = await renderFixture(ctx, 'internship-certificate', { number: NUMBER });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('internship-certificate', a.pdf);
}));

test('internship certificate: legacy positions (DISCOVERY A8 §4)', () => withExampleCtx(async (ctx) => {
  const { pdf, html, md } = await renderFixture(ctx, 'internship-certificate', { number: NUMBER });
  const items = await extractItems(pdf);
  assert.deepEqual([...new Set(items.map((i) => i.page))], [1]);
  // Ref left and date right, Bold 9.5, at MT + CP + 25.
  const ref = find(items, `Ref: ${NUMBER}`);
  assert.deepEqual([ref.x, ref.y, ref.size, ref.font], [ML, 135, 9.5, 'Manrope-Bold']);
  const date = find(items, 'Date: 29 August 2026');
  assert.equal(date.y, 135);
  near(date.x + date.width, RIGHT, 'date right edge');
  const title = find(items, 'INTERNSHIP COMPLETION CERTIFICATE');
  assert.deepEqual([title.size, title.font], [14, 'Manrope-ExtraBold']);
  near(title.x + title.width / 2, ML + (RIGHT - ML) / 2, 'title centred');
  const sal = find(items, 'To Whom It May Concern,');
  assert.deepEqual([sal.x, sal.size, sal.font], [ML, 10, 'Manrope-Bold']);
  const body = find(items, 'This is to certify that');
  assert.deepEqual([body.size, body.font], [10, 'Manrope-Regular']);
  assert.ok(find(items, 'Ms. Riley Testcase'));
  // Signature: "For …" Bold 10; image h50 at +24; seal; name at image + 72; title +14; extra line +26.
  const forLine = find(items, 'For Acme Events Private Limited');
  assert.deepEqual([forLine.size, forLine.font], [10, 'Manrope-Bold']);
  const imgs = (await extractImages(pdf)).filter((im) => im.y > 100);
  assert.equal(imgs.length, 2, 'signature and seal');
  const sig = imgs.find((im) => im.x === ML);
  assert.deepEqual([sig.y, sig.height], [forLine.y + 24, 50]);
  const name = find(items, 'Sam Sample');
  assert.deepEqual([name.y, name.size], [forLine.y + 24 + 72, 10]);
  assert.equal(find(items, 'Managing Director').y, name.y + 14);
  assert.equal(find(items, 'Authorized Signatory').y, name.y + 26);
  // Footer: contact and "Page 1 of 1", no centre text.
  assert.ok(find(items, 'Page 1 of 1'));
  assert.equal(items.some((i) => i.text === 'Confidential'), false);
  assert.match(html, /INTERNSHIP COMPLETION CERTIFICATE/);
  assert.match(md, /# INTERNSHIP COMPLETION CERTIFICATE/);
  assert.match(md, new RegExp(`Ref: ${NUMBER}`));
}));

test('internship certificate: a preview prints Ref: DRAFT; without a summary the generic paragraph is used', () => withExampleCtx(async (ctx) => {
  const { summary, ...input } = fixtureInput('internship-certificate');
  assert.ok(summary);
  const { pdf } = await renderFixture(ctx, 'internship-certificate', { input, number: null, draft: true });
  const items = await extractItems(pdf);
  assert.ok(find(items, 'Ref: DRAFT'));
  assert.match(items.map((i) => i.text).join(' '), /During the internship, Riley worked on the tasks assigned by the team/);
}));
