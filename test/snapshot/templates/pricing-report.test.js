import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

const ID = 'pricing-report';
const NUMBER = 'ACM-REP-2026-001';
const ML = 37.5;
const MT = 100;
const MB = 39;
const PW = 595.28;
const PH = 841.89;
const find = (items, text, page) => items.find((i) => i.text === text && (page === undefined || i.page === page)) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('pricing report: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, ID, { number: NUMBER });
  const b = await renderFixture(ctx, ID, { number: NUMBER });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot(ID, a.pdf);
}));

test('pricing report: centred cover, contents, Delegate Paid / Organiser Paid tables (DISCOVERY A8 §14)', () => withExampleCtx(async (ctx) => {
  const { pdf, md } = await renderFixture(ctx, ID, { number: NUMBER });
  const items = await extractItems(pdf);
  assert.equal(Math.max(...items.map((i) => i.page)), 5);
  // Cover: vertically centred by the legacy estimate; everything centred.
  const est = 24 * 1.3 + 20 + 13 * 1.3 + 36 + 12 * 1.3 + 4 + 12 * 1.3 + 28 + 18 + 12 * 1.3 + 0.6 * 12 * 1.3 + 3 * 11 * 1.3 + 2 * 0.35 * 11 * 1.3;
  const title = find(items, 'Ticket Pricing Models', 1);
  assert.deepEqual([title.size, title.font], [24, 'Manrope-SemiBold']);
  near(title.y, MT + (PH - MT - MB - est) / 2, 'cover start');
  near(title.x + title.width / 2, PW / 2, 'title centred');
  const subtitle = find(items, 'Workshops, Classes & Events', 1);
  assert.deepEqual([subtitle.size, subtitle.font], [14, 'Manrope-Regular']);
  assert.deepEqual(find(items, 'Prepared for', 1).size, 12);
  assert.deepEqual(find(items, 'ACME EVENTS PRIVATE LIMITED', 1).font, 'Manrope-Bold');
  const reportNo = find(items, `Report Number: ${NUMBER}`, 1);
  const date = find(items, 'Date: October 29, 2026', 1);
  assert.deepEqual([reportNo.size, date.size], [11, 11]);
  near(reportNo.x + reportNo.width / 2, PW / 2, 'details centred');
  assert.ok(find(items, 'Client: Sample Society of Placeholders, Example Town', 1));
  // Contents: top-level entries only, page numbers Regular 11.5 right-aligned.
  const nums = items.filter((i) => i.page === 2 && /^\d$/.test(i.text) && i.x > PW / 2);
  assert.deepEqual(nums.map((i) => i.text), ['3', '3', '4', '4', '5', '5']);
  assert.deepEqual([nums[0].size, nums[0].font], [11.5, 'Manrope-Regular']);
  // Unnumbered h1 headings; plain justified paragraphs; fixed 24 pt rows with text at +6, Bold 10 headers, black totals.
  const h1 = find(items, 'Overview', 3);
  assert.deepEqual([h1.x, h1.size, h1.font], [ML, 18, 'Manrope-ExtraBold']);
  const head = find(items, 'Particulars', 3);
  assert.deepEqual([head.x, head.size, head.font], [ML + 10, 10, 'Manrope-Bold']);
  const baseRow = items.find((i) => i.text === 'Base Ticket Price' && i.page === 3);
  assert.deepEqual([baseRow.y, baseRow.font, baseRow.size], [head.y + 24, 'Manrope-Bold', 9.5]);
  const pf = find(items, 'Platform Fee (2%)', 3);
  assert.deepEqual([pf.y, pf.font], [head.y + 48, 'Manrope-Regular']);
  // ₹1,000 at 2% + 18%, gateway 2% + 18%: delegate pays ₹1,047.75; organiser nets ₹952.80.
  const final = find(items, 'Final Amount Paid by Delegate', 3);
  assert.deepEqual([final.y, final.font, final.size], [head.y + 7 * 24, 'Manrope-Bold', 10]);
  const totals = items.filter((i) => i.page === 3 && i.y === final.y).map((i) => i.text);
  assert.deepEqual(totals, ['Final Amount Paid by Delegate', '₹1,047.75', '₹1,000.00']);
  const dp = items.find((i) => i.text === '₹1,047.75' && i.page === 3);
  near(dp.x + dp.width, ML + 210 + 155 - 10, 'second column right edge');
  assert.ok(find(items, '₹952.80', 3));
  assert.ok(find(items, 'Pricing Model: Delegate Paid', 4));
  const org = find(items, 'Pricing Model: Organiser Paid', 4);
  assert.deepEqual([org.size, org.font], [13, 'Manrope-Bold']);
  assert.ok(find(items, 'Amount Received by Organiser (Net)', 4));
  assert.ok(find(items, 'Summary', 5));
  near(find(items, 'Page 1 of 5', 1).y, PH - MB + 8, 'footer');
  assert.equal(items.some((i) => i.text.includes('**')), false);
  assert.match(md, /\| \*\*Final Amount Paid by Delegate\*\* \| \*\*₹1,047.75\*\* \| \*\*₹1,000.00\*\* \|/);
  assert.match(md, /- 4\. Pricing Model: Organiser Paid/);
}));

test('pricing report: tier tables, rates from the fees field, examplePrice', () => withExampleCtx(async (ctx) => {
  const input = {
    ...fixtureInput(ID),
    fees: { platformPercent: 2.5 },
    examplePrice: 500,
    sections: [
      { title: 'Charges', blocks: [{ type: 'custom', name: 'feeTable', data: { kind: 'tiers', bases: [250, 450] } }] },
      { title: 'Summary', blocks: [{ type: 'custom', name: 'feeTable', data: { kind: 'tierSummary', bases: [250, 450] } }, { type: 'custom', name: 'feeTable', data: { kind: 'delegatePaid' } }] },
    ],
  };
  const { pdf } = await renderFixture(ctx, ID, { input, number: NUMBER });
  const items = await extractItems(pdf);
  // Legacy tiered report: ₹250 -> 6.25, 1.13, 257.38, 5.15, 0.93, 263.46; ₹450 -> 11.25, 2.03, 463.28, 9.27, 1.67, 474.22.
  for (const t of ['₹250.00 Ticket', '₹450.00 Ticket', 'Platform Fee (2.5%)', '₹6.25', '₹1.13', '₹257.38', '₹5.15', '₹0.93', '₹11.25', '₹2.03', '₹463.28', '₹9.27', '₹1.67', '₹263.46', '₹474.22']) {
    assert.ok(items.some((i) => i.text === t), t);
  }
  const t2 = items.find((i) => i.text === '₹450.00 Ticket');
  near(t2.x + t2.width, PW - ML - 10, 'last tier column takes the rest');
  assert.ok(items.some((i) => i.text === '₹500.00'), 'examplePrice is the delegatePaid base');
}));

test('pricing report: a table longer than a page continues with its header', () => withExampleCtx(async (ctx) => {
  const rows = Array.from({ length: 40 }, (_, i) => [`Row ${i + 1}`, String(i)]);
  const input = { ...fixtureInput(ID), sections: [{ title: 'Long', blocks: [{ type: 'table', columns: [{ label: 'Item', width: 300 }, { label: 'Value', align: 'right' }], rows }] }] };
  const { pdf } = await renderFixture(ctx, ID, { input, number: NUMBER });
  const items = await extractItems(pdf);
  const cells = items.filter((i) => /^Row \d+$/.test(i.text));
  assert.equal(cells.length, 40);
  for (const c of cells) assert.ok(c.y + 24 - 6 <= PH - MB - 10, `${c.text} below the content area`);
  const pages = [...new Set(cells.map((c) => c.page))];
  assert.equal(pages.length, 2);
  const heads = items.filter((i) => i.text === 'Item' && i.font === 'Manrope-Bold');
  assert.deepEqual(heads.map((h) => h.page), pages, 'header repeated');
  const first2 = cells.find((c) => c.page === pages[1]);
  assert.equal(first2.y, heads[1].y + 24);
}));
