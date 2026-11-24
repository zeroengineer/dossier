import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { clearImageCache } from '../../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

sharp.cache(false);
const ML = 37.5;
const CW = 595.28 - 75;
const RIGHT = 595.28 - 37.5;
const ID = 'expense-statement';
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('expense statement: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, ID, { number: null });
  clearImageCache();
  const b = await renderFixture(ctx, ID, { number: null });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot(ID, a.pdf);
}));

test('expense statement: legacy positions, smaller letterhead and footer (DISCOVERY A8 §10)', () => withExampleCtx(async (ctx) => {
  const { pdf, values, md } = await renderFixture(ctx, ID, { number: null });
  assert.equal(values.total, 795600);
  const items = await extractItems(pdf);
  assert.deepEqual([...new Set(items.map((i) => i.page))], [1, 2]);
  assert.equal(find(items, 'Acme Events Private Limited').size, 8, 'letterhead name 8');
  assert.equal(find(items, 'CIN: U00000XX2000PTC000000').size, 7.5);
  assert.ok(items.filter((i) => i.text === 'Confidential').every((i) => i.size === 7), 'footer 7');
  const title = find(items, 'EXPENSE REIMBURSEMENT STATEMENT');
  assert.deepEqual([title.size, title.font], [16, 'Manrope-ExtraBold']);
  near(title.x + title.width / 2, ML + CW / 2, 'title centred');
  const value = find(items, '15 September 2026');
  near(value.x + value.width, RIGHT, 'date right edge');
  const label = find(items, 'Date:');
  assert.deepEqual([label.font, label.y], ['Manrope-SemiBold', value.y]);
  near(label.x + label.width, value.x, 'label right before the value (one space)', 3);
  const to = find(items, 'To');
  assert.deepEqual([to.x, to.y, to.size], [ML, value.y + 30, 10.5]);
  // Bordered table: header Bold 10 on #f3f4f6 (min row 28, pad 10), first column bold, amounts right-aligned.
  const ph = find(items, 'Particulars');
  assert.deepEqual([ph.x, ph.size, ph.font], [ML + 10, 10, 'Manrope-Bold']);
  assert.equal(find(items, 'Calculation').x, ML + 170 + 10);
  const amt = find(items, '6,000');
  near(amt.x + amt.width, RIGHT - 10, 'amount right edge');
  assert.equal(find(items, 'Travel Expenses').font, 'Manrope-Bold');
  assert.equal(find(items, '₹7,956').font, 'Manrope-Bold');
  assert.ok(find(items, 'Rupees Seven Thousand Nine Hundred Fifty Six Only.'));
  // Bank details on page 2 (legacy 180 pt keep-together), h2 Bold 13; sign-off with the image h44.
  const bank = find(items, 'Bank Details');
  assert.deepEqual([bank.page, bank.size], [2, 13]);
  assert.ok(find(items, 'EXMP0000000'));
  const forLine = find(items, 'For Acme Events Private Limited');
  const name = find(items, 'Alex Example');
  const imgs = (await extractImages(pdf)).filter((im) => im.page === 2 && im.y > 100);
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].height, 44);
  near(imgs[0].y, forLine.y + 14.5 + 8, 'image 8 below the For line', 1);
  near(name.y, imgs[0].y + 44 + 8, 'name 8 below the image', 0.5);
  assert.equal(name.size, 11);
  assert.match(md, /\*\*Amount in Words:\*\* Rupees Seven Thousand Nine Hundred Fifty Six Only\./);
  assert.match(md, /\| Account Number \| 000000000000 \|/);
}));

test('expense statement: bank details from input, no agreement sentence; unknown bank account is a field error', () => withExampleCtx(async (ctx) => {
  const input = { ...fixtureInput(ID), agreementDate: undefined, bankDetails: [{ label: 'Account', value: 'Placeholder Account 1' }] };
  const { pdf } = await renderFixture(ctx, ID, { input, number: null });
  const items = await extractItems(pdf);
  assert.ok(find(items, 'Placeholder Account 1'));
  assert.equal(items.some((i) => /agreement dated/.test(i.text)), false);
  const { getTemplate } = await import('../../../src/services/templates.js');
  const { resolveTemplateFields } = await import('../../../src/services/fields.js');
  const t = await getTemplate(ctx, ID);
  const r = resolveTemplateFields(ctx, t, { ...fixtureInput(ID), bankAccount: '999999' }, { brandId: 'acme' });
  assert.deepEqual(r.errors.map((e) => e.name), ['bank']);
}));
