import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

const ID = 'proposal';
const NUMBER = 'ACM-Q-EXC26-2026-01';
const ML = 37.5;
const MT = 100;
const MB = 39;
const PW = 595.28;
const PH = 841.89;
const CW = PW - 75;
const find = (items, text, page) => items.find((i) => i.text === text && (page === undefined || i.page === page)) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('proposal: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, ID, { number: NUMBER });
  const b = await renderFixture(ctx, ID, { number: NUMBER });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot(ID, a.pdf);
}));

test('proposal: gen-2 cover, contents with page numbers, cards, tables, sign-off (DISCOVERY A8 §13)', () => withExampleCtx(async (ctx) => {
  const { pdf, md, html } = await renderFixture(ctx, ID, { number: NUMBER });
  const items = await extractItems(pdf);
  assert.equal(Math.max(...items.map((i) => i.page)), 5);

  // Cover: title SemiBold 24 centred; details rows 22 apart, values at ML + 150, block ending 45 pt above the footer.
  const title = find(items, 'Acme Tickets - Service Proposal', 1);
  assert.deepEqual([title.size, title.font], [24, 'Manrope-SemiBold']);
  near(title.x + title.width / 2, PW / 2, 'title centred');
  const sub = find(items, 'Example Conference 2026 - Sample College', 1);
  assert.deepEqual([sub.size, sub.font], [16, 'Manrope-Bold']);
  const details = find(items, 'Proposal Details', 1);
  assert.deepEqual([details.size, details.font, details.x], [13, 'Manrope-Bold', ML]);
  const rows = ['Proposal Type:', 'Quotation Number:', 'Date:', 'Prepared For:', '', 'Submitted By:'];
  const divY = PH - MB - 45 - (26 + 6 * 22) - 22;
  near(details.y, divY + 22, 'details heading below the divider');
  const typeLabel = find(items, 'Proposal Type:', 1);
  assert.deepEqual([typeLabel.size, typeLabel.font], [11, 'Manrope-SemiBold']);
  assert.equal(find(items, 'Quotation Number:', 1).y, typeLabel.y + 22);
  const number = find(items, NUMBER, 1);
  assert.deepEqual([number.x, number.y], [ML + 150, typeLabel.y + 22]);
  assert.equal(find(items, 'Example Institute of Sample Studies', 1).y, typeLabel.y + 4 * 22, 'continuation row');
  assert.equal(find(items, 'Submitted By:', 1).y, typeLabel.y + (rows.length - 1) * 22);
  assert.ok(find(items, '13 November 2026', 1));

  // Contents: numbers at ML, titles at ML+22 SemiBold 11.5; sub-entries Regular 11; page numbers right-aligned in #aaa.
  const contents = find(items, 'Contents', 2);
  assert.deepEqual([contents.size, contents.font], [18, 'Manrope-ExtraBold']);
  const e1 = find(items, 'Platform Overview', 2);
  assert.deepEqual([e1.x, e1.size, e1.font], [ML + 22, 11.5, 'Manrope-SemiBold']);
  const sub1 = find(items, '2.1 Pricing Calculation Tables', 2);
  assert.deepEqual([sub1.x, sub1.size, sub1.font], [ML + 22, 11, 'Manrope-Regular']);
  const pageNums = items.filter((i) => i.page === 2 && /^\d$/.test(i.text) && i.x > PW / 2);
  assert.deepEqual(pageNums.map((i) => i.text), ['3', '3', '3', '4', '5', '5', '5']);
  for (const p of pageNums) near(p.x + p.width, PW - ML, 'page number right-aligned');
  assert.equal(pageNums[0].y, e1.y);
  assert.equal(pageNums[2].size, 11, 'sub-entry page number size');

  // Sections: h1 ExtraBold 18 at MT + CP + 0.3 lines; numbered "1. …"; subsections "2.1  …" Bold 13.
  const h1 = find(items, '1. Platform Overview', 3);
  assert.deepEqual([h1.x, h1.size, h1.font], [ML, 18, 'Manrope-ExtraBold']);
  assert.ok(h1.y > MT + 10 && h1.y < MT + 20);
  const h2 = find(items, '2.1 Pricing Calculation Tables', 3); // "2.1  …" (pdfjs joins the two spaces)
  assert.deepEqual([h2.size, h2.font], [13, 'Manrope-Bold']);
  // Fee card: ExtraBold 36 value at boxY + 28, label SemiBold 8.5 at boxY + 16, title at ML + 120.
  const label = find(items, 'DOMESTIC FEE');
  assert.deepEqual([label.x, label.size, label.font], [ML + 18, 8.5, 'Manrope-SemiBold']);
  const value = items.find((i) => i.text === '2%' && i.size === 36);
  assert.deepEqual([value.x, value.y, value.font], [ML + 18, label.y + 12, 'Manrope-ExtraBold']);
  const cardTitle = find(items, 'Per domestic registration');
  assert.deepEqual([cardTitle.x, cardTitle.y, cardTitle.size], [ML + 120, label.y, 11.5]);
  const intl = find(items, 'INTERNATIONAL');
  assert.equal(intl.y, label.y + 84 + 14 + 4, 'second card follows at box height + 14 + 4');
  // Registration table: fee maths (₹4,720 at 2% + 18%, gateway 2% + 18%), header SemiBold white, columns 85/75/75/65/65/80/75.
  assert.ok(find(items, '₹94.40') && find(items, '₹96.63') && find(items, '₹225.41') && find(items, '₹4,945.41'));
  assert.ok(find(items, 'USD 7.68') && find(items, 'USD 264.96'));
  const total = find(items, '₹4,945.41');
  near(total.x + total.width, ML + 520 - 8, 'last column right-aligned at its padding');
  // Bold rows: the last bold row is a black bar (white Bold), the one above it grey.
  const subtotal = find(items, 'Subtotal');
  const grand = items.find((i) => i.text === 'Total' && i.font === 'Manrope-Bold');
  assert.deepEqual([subtotal.font, grand.font], ['Manrope-Bold', 'Manrope-Bold']);
  // Price card: amount ExtraBold 32 at boxY + 30, tax label 8 at + 72, words SemiBold 9.5 at + 84 at ML + 195.
  const amount = find(items, '₹7,500');
  assert.deepEqual([amount.size, amount.font], [32, 'Manrope-ExtraBold']);
  const tax = find(items, 'Including GST');
  assert.deepEqual([tax.size, tax.y], [8, amount.y + 42]);
  const words = find(items, 'In words: Seven Thousand Five Hundred Only (Including GST)');
  assert.deepEqual([words.x, words.y, words.size, words.font], [ML + 195, amount.y + 54, 9.5, 'Manrope-SemiBold']);
  // Sign-off: two columns CW/2 - 10 wide, 20 apart; rows 20 apart, values at +108.
  const heads = [find(items, 'PROJECT CONTACT'), find(items, 'AUTHORIZED SIGNATORY')];
  assert.deepEqual(heads.map((h) => [h.size, h.font]), [[9.5, 'Manrope-SemiBold'], [9.5, 'Manrope-SemiBold']]);
  assert.equal(heads[0].x, ML);
  near(heads[1].x, ML + CW / 2 + 10, 'second column');
  const contact = find(items, 'Alex Example');
  const signer = find(items, 'Sam Sample');
  assert.deepEqual([contact.x, contact.y], [ML + 108, heads[0].y + 22]);
  near(signer.x, ML + CW / 2 + 10 + 108, 'second column value');
  assert.equal(signer.y, heads[0].y + 22);
  assert.equal(find(items, 'Managing Director').y, signer.y + 20);
  // Footer and letterhead.
  const pageLabel = find(items, 'Page 3 of 5');
  near(pageLabel.y, PH - MB + 8, 'footer');
  assert.equal((await extractImages(pdf)).length, 5, 'letterhead logo on every page');

  assert.match(md, /^# Acme Tickets - Service Proposal/);
  assert.match(md, /- \*\*Prepared For:\*\* Convener - Example Conference 2026, Example Institute of Sample Studies/);
  assert.match(md, /\| ₹4,720.00 \| ₹94.40 \| ₹16.99 \| ₹96.63 \| ₹17.39 \| ₹225.41 \| ₹4,945.41 \|/);
  assert.match(md, /\| \*\*Total\*\* \| \*\*₹32,500\*\* \|/);
  assert.match(md, /> \*\*TOTAL AMOUNT: ₹7,500\*\* \(Including GST\)/);
  assert.match(html, /proposal-card/);
}));

test('proposal: default sections; bad sections and rates are field errors', () => withExampleCtx(async (ctx) => {
  const { sections, ...rest } = fixtureInput(ID);
  const base = await renderFixture(ctx, ID, { input: rest, number: NUMBER });
  const items = await extractItems(base.pdf);
  assert.ok(find(items, '1. Overview') && find(items, '5. Contact Information'));
  assert.ok(find(items, 'Platform Fee'));
  assert.ok(items.some((i) => i.text.startsWith('2% of the amount paid')));

  const { getTemplate } = await import('../../../src/services/templates.js');
  const { resolveTemplateFields } = await import('../../../src/services/fields.js');
  const t = await getTemplate(ctx, ID);
  const errorsOf = (s) => resolveTemplateFields(ctx, t, { ...rest, sections: s }, { brandId: 'acme' }).errors.map((e) => e.message).join('\n');
  assert.match(errorsOf([{ blocks: [] }]), /sections\[0\]\.title is required/);
  assert.match(errorsOf([{ title: 'A', blocks: [{ type: 'custom', name: 'chart' }] }]), /unknown custom block "chart"/);
  assert.match(errorsOf([{ title: 'A', blocks: [{ type: 'custom', name: 'feeTable', data: { kind: 'nope' } }] }]), /feeTable kind "nope"/);
  assert.match(errorsOf([{ title: 'A', blocks: [{ type: 'custom', name: 'feeTable', data: { kind: 'delegatePaid', base: 'abc' } }] }]), /not a non-negative amount/);
  assert.match(errorsOf([{ title: 'A', blocks: [{ type: 'signature', party: 'X' }] }]), /signature blocks are not used here/);
  assert.match(errorsOf([{ title: 'A', blocks: [{ type: 'paragraph' }] }]), /text is required/);
  const noPrice = resolveTemplateFields(ctx, t, { ...rest, price: undefined, sections: [{ title: 'A', blocks: [{ type: 'custom', name: 'priceCard' }] }] }, { brandId: 'acme' });
  assert.match(noPrice.errors.map((e) => e.message).join(), /price card needs data.amount or the price field/);
  const badFees = resolveTemplateFields(ctx, t, { ...rest, fees: { gstPercent: 120 } }, { brandId: 'acme' });
  assert.match(badFees.errors.map((e) => e.message).join(), /gstPercent must be a number from 0 to 100/);
}));
