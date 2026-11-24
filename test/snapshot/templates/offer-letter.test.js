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

test('offer letter: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, 'offer-letter', { number: null });
  clearImageCache();
  const b = await renderFixture(ctx, 'offer-letter', { number: null });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot('offer-letter', a.pdf);
}));

test('offer letter: page 1 and forced page breaks (DISCOVERY A8 §2)', () => withExampleCtx(async (ctx) => {
  const { pdf, html, md } = await renderFixture(ctx, 'offer-letter', { number: null });
  const items = await extractItems(pdf);
  // Date BodyBold 10 right-aligned at MT + CP + 20; no reference line for an unnumbered letter.
  const date = find(items, 'Date: 29 August 2026');
  assert.deepEqual([date.page, date.y, date.size, date.font], [1, 130, 10, 'Manrope-Bold']);
  near(date.x + date.width, RIGHT, 'date right edge');
  assert.equal(items.some((i) => i.text.startsWith('Ref:')), false);
  // "To," at MT + CP + 45, then the name (10.5) and address lines (10, lineGap 3).
  assert.deepEqual([find(items, 'To,').x, find(items, 'To,').y], [ML, 155]);
  assert.equal(find(items, 'Jordan Placeholder').size, 10.5);
  const a1 = find(items, 'House No. 0, Sample Street');
  const a2 = find(items, 'Example Town');
  assert.equal(a1.size, 10);
  near(a2.y - a1.y, 16.5, 'address line step (10 pt Manrope + lineGap 3)');
  const subject = find(items, 'SUBJECT: OFFER OF EMPLOYMENT WITH ACME EVENTS PRIVATE LIMITED');
  assert.deepEqual([subject.size, subject.font], [12, 'Manrope-Bold']);
  near(subject.x + subject.width / 2, ML + (RIGHT - ML) / 2, 'subject centred');
  assert.equal(find(items, 'Dear Jordan,').size, 10.5);
  // Opening paragraphs on page 1, then a page break before the terms, the annexure and the acceptance.
  assert.equal(find(items, 'The break-up of your CTC is set out in Annexure 1.').page, 1);
  const pages = Math.max(...items.map((i) => i.page));
  assert.equal(find(items, 'TERMS OF EMPLOYMENT').page, 2);
  assert.equal(find(items, 'TERMS OF EMPLOYMENT').size, 17);
  assert.equal(find(items, '1. Employment Status').size, 12);
  assert.ok(find(items, '15. Governing Law and Jurisdiction'));
  const annex = find(items, 'ANNEXURE 1 – SALARY STRUCTURE');
  assert.equal(annex.page, pages - 1);
  assert.equal(items.filter((i) => i.page === annex.page && i.y > 100 && i.y < 800)[0].text, annex.text, 'annexure starts its page');
  assert.equal(find(items, 'ACCEPTANCE OF OFFER').page, pages);
  // Footer: contact left, Confidential centre, Page n of N right.
  for (let p = 1; p <= pages; p++) {
    const n = find(items, `Page ${p} of ${pages}`, p);
    assert.equal(n.y, 811);
    near(n.x + n.width, RIGHT, 'page number right edge');
    assert.equal(find(items, 'Confidential', p).size, 7.5);
    assert.equal(find(items, 'hr@example.com | www.example.com', p).x, ML);
  }
  assert.match(html, /OFFER OF EMPLOYMENT WITH ACME EVENTS PRIVATE LIMITED/);
  assert.match(md, /## 1\. Employment Status/);
  assert.match(md, /\| Basic Salary \| 10,000 \| 1,20,000 \|/);
}));

test('offer letter: salary annexure tables and the signature block with the seal', () => withExampleCtx(async (ctx) => {
  const { pdf } = await renderFixture(ctx, 'offer-letter', { number: null });
  const items = await extractItems(pdf);
  const pages = Math.max(...items.map((i) => i.page));
  // Earnings: columns 200 / 150 / rest, header BodyBold 9.5 at +5, rows h22, values BodyMedium right-aligned 10 in.
  const head = find(items, 'Earnings');
  assert.deepEqual([head.x, head.size, head.font], [ML + 10, 9.5, 'Manrope-Bold']);
  const monthlyHead = find(items, 'Monthly Amount (₹)');
  near(monthlyHead.x + monthlyHead.width, ML + 200 + 150 - 10, 'monthly column right edge');
  const basic = find(items, 'Basic Salary');
  assert.deepEqual([basic.y - head.y, basic.font], [22, 'Manrope-Regular']);
  const monthly = items.find((i) => i.text === '10,000' && i.y === basic.y);
  assert.equal(monthly.font, 'Manrope-Medium');
  near(monthly.x + monthly.width, ML + 350 - 10, 'monthly value right edge');
  const annual = items.find((i) => i.text === '1,20,000' && i.y === basic.y);
  near(annual.x + annual.width, RIGHT - 10, 'annual value right edge');
  const gross = find(items, 'Gross Salary / CTC');
  assert.deepEqual([gross.y - basic.y, gross.font], [22, 'Manrope-Bold']);
  // Deductions and summary: 250 / rest.
  const amountHeads = items.filter((i) => i.text === 'Amount');
  assert.equal(amountHeads.length, 2);
  for (const a of amountHeads) near(a.x + a.width, RIGHT - 10, 'amount column right edge');
  assert.ok(find(items, 'As applicable'));
  const ctc = find(items, '₹1,20,000');
  near(ctc.x + ctc.width, RIGHT - 10, 'CTC right edge');
  // Signature: "For …" BodyBold 9.5, image h55 at +24, seal, name +22 below the image, title +14, extra line +26.
  const forLine = find(items, 'For Acme Events Private Limited', pages);
  assert.deepEqual([forLine.x, forLine.size, forLine.font], [ML, 9.5, 'Manrope-Bold']);
  const imgs = (await extractImages(pdf)).filter((im) => im.page === pages && im.y > 100);
  const sig = imgs.find((im) => im.x === ML);
  assert.deepEqual([sig.y, sig.height], [forLine.y + 24, 55]);
  assert.equal(imgs.length, 2, 'signature and seal');
  const name = find(items, 'Sam Sample', pages);
  assert.deepEqual([name.y, name.size, name.font], [forLine.y + 24 + 55 + 22, 10, 'Manrope-Bold']);
  const title = find(items, 'Managing Director', pages);
  assert.deepEqual([title.y, title.size, title.font], [name.y + 14, 9, 'Manrope-Medium']);
  const extra = find(items, 'Authorized Signatory', pages);
  assert.deepEqual([extra.y, extra.size, extra.font], [name.y + 26, 9, 'Manrope-Regular']);
}));

test('offer letter: fields replace defaults (no probation, own clauses, no seal) and totals add up in paise', () => withExampleCtx(async (ctx) => {
  const input = {
    ...fixtureInput('offer-letter'),
    probation: false,
    seal: false,
    earnings: [
      { label: 'Basic Salary', monthly: '20,000.50' },
      { label: 'House Rent Allowance', monthly: 8000, annual: '96,000' },
    ],
    deductions: [{ label: 'Provident Fund', value: '12% of basic' }],
    clauses: [{ title: 'Only Clause', paragraphs: ['Text for **{designation}**.'], bullets: ['One', 'Two'], after: ['After.'] }],
  };
  const { pdf, values } = await renderFixture(ctx, 'offer-letter', { input, number: null });
  assert.deepEqual(values.salary, {
    rows: [{ label: 'Basic Salary', monthly: 2000050, annual: 24000600 }, { label: 'House Rent Allowance', monthly: 800000, annual: 9600000 }],
    monthly: 2800050, annual: 33600600,
  });
  const items = await extractItems(pdf);
  assert.ok(find(items, '1. Only Clause'));
  assert.equal(items.some((i) => i.text === '2. Designation and Duties'), false);
  assert.ok(find(items, '28,000.50'));
  assert.ok(find(items, '₹3,36,006.00'));
  assert.ok(find(items, '12% of basic'));
  const pages = Math.max(...items.map((i) => i.page));
  const forLine = find(items, 'For Acme Events Private Limited', pages);
  const imgs = (await extractImages(pdf)).filter((im) => im.page === pages && im.y > 100);
  assert.equal(imgs.length, 1, 'no seal');
  // No-seal offsets (legacy): image at +16, name +10 below it.
  assert.equal(imgs[0].y, forLine.y + 16);
  assert.equal(find(items, 'Sam Sample', pages).y, forLine.y + 16 + 55 + 10);
}));

test('offer letter: bad clause lists and salary rows are field errors', () => withExampleCtx(async (ctx) => {
  const { resolveFields } = await import('../../../src/services/fields.js');
  const r = await resolveFields(ctx, 'offer-letter', { ...fixtureInput('offer-letter'), clauses: [{ paragraphs: ['no title'] }], earnings: [{ label: 'Basic' }] }, { brandId: 'acme' });
  assert.deepEqual(r.errors.map((e) => e.name).sort(), ['content', 'salary']);
  assert.match(r.errors.find((e) => e.name === 'content').message, /clauses\.0\.title/);
}));
