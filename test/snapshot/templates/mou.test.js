import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractItems } from '../../helpers/pdfText.js';
import { isStrongRow, MOU_FRAME } from '../../../src/render/pdf/mouFrame.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

const ID = 'mou';
const ML = 45;
const PW = 595.28;
const PH = 841.89;
const CW = PW - 90;
const CARD_W = CW / 2 - 10;
const find = (items, text, page) => items.find((i) => i.text === text && (page === undefined || i.page === page)) ?? assert.fail(`no item "${text}"`);
// pdfText rounds sizes to 0.5 pt (10.2 -> 10, 9.8 -> 10, 9.3 -> 9.5).
const R = (v) => Math.round(v * 2) / 2;
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);
const EVENT = {
  ...fixtureInput(ID), variant: 'event', engagement: 'Example Fest 2026 - Sample College',
  event: { dates: '10–12 February 2026', venue: 'Sample College Campus', type: 'Cultural festival' },
};

test('mou: byte-identical renders and geometry snapshots (both variants)', () => withExampleCtx(async (ctx) => {
  for (const [name, input] of [[ID, fixtureInput(ID)], [`${ID}-event`, EVENT]]) {
    const a = await renderFixture(ctx, ID, { input, number: null });
    const b = await renderFixture(ctx, ID, { input, number: null });
    assert.ok(a.pdf.equals(b.pdf), `${name}: two renders differ`);
    assert.equal(a.html, b.html);
    assert.equal(a.md, b.md);
    await assertGeometrySnapshot(name, a.pdf);
  }
}));

test('mou: v2 sizes, cover, tables, signature cards and footer (DISCOVERY A8 §12)', () => withExampleCtx(async (ctx) => {
  const { pdf, md, html } = await renderFixture(ctx, ID, { number: null });
  const items = await extractItems(pdf);
  const pages = Math.max(...items.map((i) => i.page));
  // Cover: h1 centred ExtraBold 18 at MT + moveDown 0.15; h2 centred Bold 13; "AND" centred, party paragraphs justified 10.5.
  const title = find(items, 'MEMORANDUM OF UNDERSTANDING');
  assert.deepEqual([title.page, title.size, title.font], [1, 18, 'Manrope-ExtraBold']);
  near(title.x + title.width / 2, PW / 2, 'title centred');
  assert.ok(title.y > 50 && title.y < 56, `title y ${title.y}`);
  const between = find(items, 'BETWEEN');
  assert.deepEqual([between.size, between.font], [13, 'Manrope-Bold']);
  near(between.x + between.width / 2, PW / 2, 'BETWEEN centred');
  const and = find(items, 'AND');
  near(and.x + and.width / 2, PW / 2, 'AND centred');
  assert.equal(find(items, 'ACME EVENTS PRIVATE LIMITED').x, ML, 'party paragraph starts at the margin');
  // Body: h1 ExtraBold 14.5, h2 Bold 12, h3 none; paragraphs Regular 10.2; bullets SemiBold 10.2 at ML+4, text at ML+18.
  const h1 = find(items, '1. PURPOSE');
  assert.deepEqual([h1.x, h1.size, h1.font], [ML, 14.5, 'Manrope-ExtraBold']);
  const h2 = find(items, '4.1 Service Fee');
  assert.deepEqual([h2.x, h2.size, h2.font], [ML, 12, 'Manrope-Bold']);
  const bullet = items.find((i) => i.text === '•');
  assert.deepEqual([bullet.x, bullet.size, bullet.font], [ML + 4, R(10.2), 'Manrope-SemiBold']);
  const bulletText = items.find((i) => i.page === bullet.page && i.y === bullet.y && i.x > bullet.x);
  assert.equal(bulletText.x, ML + 18);
  assert.ok(items.some((i) => i.size === R(10.2) && i.font === 'Manrope-Regular'));
  // Amount emphasis: "2%" bold in the fee clause; table header Bold 9.8 white at ML+8; value column 130 wide.
  const head = find(items, 'Description');
  assert.deepEqual([head.x, head.size, head.font], [ML + 8, R(9.8), 'Manrope-Bold']);
  near(find(items, 'Amount').x, ML + CW - 130 + 8, 'value column 130 wide');
  const row = find(items, 'Ticket price');
  assert.deepEqual([row.size, row.font], [R(9.3), 'Manrope-Regular']);
  near(row.y, head.y + 9.8 * 1.366 + 2 * 6.5, 'header height = text height + 2 x pad 6.5', 0.6);
  near(find(items, 'Service fee (2%)').y, row.y + 9.3 * 1.366 + 2 * 6.5, 'auto row height', 0.6);
  const strong = find(items, 'Amount received by the Organisation');
  assert.equal(strong.font, 'Manrope-Bold', 'net rows are bold');
  assert.equal(find(items, '₹1,023.60').font, 'Manrope-Bold');
  // Keep-together: ORGANISATION DETAILS needs 450 pt, so it starts high on the last page with the signatures.
  const details = find(items, 'ORGANISATION DETAILS (FOR REFERENCE)');
  assert.ok(details.y < PH - 50 - 450, 'organisation details kept together');
  // Signature cards: titles Bold 10 at card x + 12; "Authorized Signatory" Bold 9.5; fields Medium 9 every 16 pt;
  // values SemiBold 8.5 at label + 5; the partner card leaves its fields blank.
  const t1 = find(items, 'For ACME EVENTS PRIVATE LIMITED');
  const t2 = find(items, 'For EXAMPLE INSTITUTE OF SAMPLE STUDIES');
  assert.deepEqual([t1.x, t1.size, t1.font, t1.page], [ML + 12, 10, 'Manrope-Bold', pages]);
  near(t2.x, ML + CARD_W + 20 + 12, 'second card');
  assert.equal(t2.y, t1.y);
  const auth = items.filter((i) => i.text === 'Authorized Signatory');
  assert.deepEqual(auth.map((i) => [i.size, i.font]), [[9.5, 'Manrope-Bold'], [9.5, 'Manrope-Bold']]);
  const names = items.filter((i) => i.text === 'Name:');
  assert.equal(names.length, 2);
  assert.deepEqual(names.map((i) => [i.size, i.font]), [[9, 'Manrope-Medium'], [9, 'Manrope-Medium']]);
  const seal = items.filter((i) => i.text === 'Seal:');
  near(seal[0].y, names[0].y + 3 * 16, 'four fields 16 apart');
  const value = find(items, 'Sam Sample');
  assert.deepEqual([value.size, value.font], [R(8.5), 'Manrope-SemiBold']);
  near(value.x, names[0].x + names[0].width + 5, 'value after the label');
  assert.equal(items.filter((i) => i.text === 'Managing Director').length, 1, 'the partner card has no values');
  // Footer: "Page i of n" Regular 7.5 right-aligned at PH - 34 + 6.
  for (let p = 1; p <= pages; p++) {
    const f = find(items, `Page ${p} of ${pages}`, p);
    assert.deepEqual([f.size, f.font], [7.5, 'Manrope-Regular']);
    near(f.y, PH - 34 + 6, 'footer text at PH - 34 + 6');
    near(f.x + f.width, PW - 45, 'footer right');
  }
  assert.equal(items.some((i) => /DO NOT SIGN|DRAFT/.test(i.text)), false);
  assert.equal(items.some((i) => /Reference:/.test(i.text)), false, 'no number, no reference line');
  // Markdown rendition: the filled body verbatim; HTML: cards, no letterhead.
  assert.match(md, /^# MEMORANDUM OF UNDERSTANDING\n/);
  assert.match(md, /\| Service fee \(2%\) \| ₹20\.00 \|/);
  assert.match(md, /## For ACME EVENTS PRIVATE LIMITED\n\nAuthorized Signatory\n\nName: Sam Sample/);
  assert.doesNotMatch(md, /\{\{/);
  assert.match(html, /class="mou-signatures"/);
  assert.doesNotMatch(html, /class="letterhead"/);
}));

test('mou: event variant body, card fields and the draft watermark param', () => withExampleCtx(async (ctx) => {
  const input = { ...EVENT, watermark: true, partnerSignatory: { name: 'Riley Testcase', designation: 'Coordinator' } };
  const { pdf, md, html } = await renderFixture(ctx, ID, { input, number: 'ACM-DOC-2026-0001' });
  const items = await extractItems(pdf);
  assert.match(md, /for \*\*Example Fest 2026 - Sample College\*\* \(the "Event"\), scheduled for 10–12 February 2026 at Sample College Campus/);
  assert.match(md, /Reference: ACM-DOC-2026-0001/);
  const ev = find(items, 'EVENT DETAILS');
  const part = find(items, 'Particular');
  assert.equal(part.y > ev.y, true);
  near(find(items, 'Details').x, ML + 135 + 8, 'Particular tables have a 135 pt label column');
  const names = items.filter((i) => i.text === 'Name:');
  const seal = items.filter((i) => i.text === 'Seal:');
  near(seal[0].y, names[0].y + 4 * 16, 'five fields (Contact added)');
  assert.ok(find(items, '+00 00000 00000'));
  assert.ok(find(items, 'Riley Testcase'));
  const pages = Math.max(...items.map((i) => i.page));
  const marks = items.filter((i) => i.text === 'DRAFT — DO NOT SIGN');
  assert.equal(marks.length, 3 * pages, 'three watermark rows per page');
  assert.ok(marks.every((m) => m.size === 38 && m.font === 'Manrope-Bold'));
  assert.match(html, /DRAFT — DO NOT SIGN/);
}));

test('mou: the event variant needs an event name; a brand can change the frame per variant', () => withExampleCtx(async (ctx) => {
  const { getTemplate } = await import('../../../src/services/templates.js');
  const { resolveTemplateFields } = await import('../../../src/services/fields.js');
  const t = await getTemplate(ctx, ID);
  const r = resolveTemplateFields(ctx, t, { ...fixtureInput(ID), variant: 'event' }, { brandId: 'acme' });
  assert.deepEqual(r.errors.map((e) => e.name), ['event.name']);
  assert.match(r.errors[0].message, /event variant needs an event name/);
  const named = resolveTemplateFields(ctx, t, { ...fixtureInput(ID), variant: 'event', event: { name: 'Example Gala' } }, { brandId: 'acme' });
  assert.deepEqual(named.errors, []);
  assert.equal(named.values.event.name, 'Example Gala');
  const brand = ctx.ws.brands.get('acme');
  ctx.ws.brands.set('acme', { ...brand, templateParams: { mou: { frame: { footer: { right: 'Seite {page}/{pages}' } } } } });
  try {
    const { pdf } = await renderFixture(ctx, ID, { number: null });
    const items = await extractItems(pdf);
    assert.ok(items.some((i) => /^Seite 1\/\d$/.test(i.text)));
  } finally {
    ctx.ws.brands.set('acme', brand);
  }
}));

test('mou: total/net rows match whole words only', () => {
  const p = MOU_FRAME.table.strong.patterns;
  for (const row of [['Net amount', '₹1'], ['Amount received by the Organisation', 'x'], ['**Amount (Net)**', '1'], ['Final Amount Paid', '2']]) {
    assert.equal(isStrongRow(row, p), true, row[0]);
  }
  for (const row of [['Internet access', '₹1'], ['Network charges', '1'], ['Netaji Hall hire', '2'], ['Cabinet', 'Planet']]) {
    assert.equal(isStrongRow(row, p), false, row[0]);
  }
});
