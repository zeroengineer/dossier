import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const RIGHT = 595.28 - 37.5;
const ID = 'remittance-statement';
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('remittance statement: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, ID, { number: null });
  clearImageCache();
  const b = await renderFixture(ctx, ID, { number: null });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot(ID, a.pdf);
}));

test('remittance statement: legacy positions and CONFIDENTIAL footer (DISCOVERY A8 §8)', () => withExampleCtx(async (ctx) => {
  const { pdf, values, md } = await renderFixture(ctx, ID, { number: null });
  assert.equal(values.total, 50000000);
  const items = await extractItems(pdf);
  assert.deepEqual([...new Set(items.map((i) => i.page))], [1]);
  const date = find(items, 'Date: 10 April 2026');
  assert.deepEqual([date.y, date.size, date.font], [124, 9.5, 'Manrope-Bold']);
  near(date.x + date.width, RIGHT, 'date right-aligned');
  const sal = find(items, 'To Whom It May Concern');
  assert.deepEqual([sal.x, sal.y, sal.size], [ML, 154, 10]);
  const subject = find(items, 'Subject: Payment Remittance Statement – Sample Annual Meet 2026 – First Transfer');
  assert.deepEqual([subject.size, subject.font], [10.5, 'Manrope-Bold']);
  near(subject.y, 154 + 13.5 + 18, 'subject', 0.5);
  // Paragraph 10 / lineGap 7 with bold runs; detail list rows 19 apart, label at ML+18, value at ML+148.
  const amount = find(items, '₹5,00,000/-');
  assert.equal(amount.font, 'Manrope-Bold');
  assert.ok(items.some((i) => /\(Rupees Five Lakh Only\)/.test(i.text)));
  const intro = find(items, 'The details of the transaction are as follows:');
  const row1 = find(items, 'Date of Transaction');
  assert.deepEqual([row1.x, row1.y], [ML + 18, intro.y + 22]);
  assert.equal(find(items, ': 10 April 2026').x, ML + 18 + 130);
  assert.equal(find(items, 'Particulars').y, row1.y + 19);
  assert.equal(items.some((i) => i.text === 'Transaction Reference'), false, 'empty rows are left out');
  const acct = find(items, 'Receiving Account Details:');
  assert.equal(acct.y, row1.y + 3 * 19 + 18);
  assert.equal(find(items, 'Account Name').y, acct.y + 22);
  // Signature: For line Bold 10; image h46 at +22; seal 76 wide at y-4; name +46+10; title +15 Medium 9.
  const forLine = find(items, 'For Acme Events Private Limited');
  assert.deepEqual([forLine.x, forLine.size, forLine.font], [ML, 10, 'Manrope-Bold']);
  const name = find(items, 'Alex Example');
  assert.deepEqual([name.y, name.size], [forLine.y + 22 + 46 + 10, 10]);
  const title = find(items, 'Chief Operating Officer');
  assert.deepEqual([title.y, title.size, title.font], [name.y + 15, 9, 'Manrope-Medium']);
  const imgs = (await extractImages(pdf)).filter((im) => im.y > 100);
  assert.equal(imgs.length, 2, 'signature and seal');
  const sig = imgs.find((im) => im.x === ML);
  assert.deepEqual([sig.y, sig.height], [forLine.y + 22, 46]);
  const footer = items.filter((i) => i.y > 800);
  const conf = footer.find((i) => i.font === 'Manrope-SemiBold');
  assert.ok(conf && conf.text.replace(/\s/g, '') === 'CONFIDENTIAL', 'caps footer');
  assert.ok(find(items, 'Page 1 of 1'));
  assert.match(md, /- \*\*Account Number:\*\* 000000000000/);
}));

test('remittance statement: numbered brand prints Ref:, no seal, subject from input; bad account is a field error', () => withExampleCtx(async (ctx) => {
  const input = { ...fixtureInput(ID), seal: false, subject: 'Subject: Transfer confirmation', transactionRef: 'TXN-0000' };
  const brand = ctx.ws.brands.get('acme');
  ctx.ws.brands.set('acme', { ...brand, series: { ...brand.series, [ID]: 'report' } });
  try {
    const { pdf } = await renderFixture(ctx, ID, { input, number: 'ACM-REP-2026-001' });
    const items = await extractItems(pdf);
    const ref = find(items, 'Ref: ACM-REP-2026-001');
    assert.deepEqual([ref.x, ref.y], [ML, 124]);
    assert.ok(find(items, 'Subject: Transfer confirmation'));
    assert.ok(find(items, 'Transaction Reference'));
    assert.equal((await extractImages(pdf)).filter((im) => im.y > 100).length, 1, 'no seal');
  } finally {
    ctx.ws.brands.set('acme', brand);
  }
  const { getTemplate } = await import('../../../src/services/templates.js');
  const { resolveTemplateFields } = await import('../../../src/services/fields.js');
  const t = await getTemplate(ctx, ID);
  const r = resolveTemplateFields(ctx, t, { ...fixtureInput(ID), account: [{ label: 'Bank' }] }, { brandId: 'acme' });
  assert.deepEqual(r.errors.map((e) => e.name), ['accountRows']);
}));
