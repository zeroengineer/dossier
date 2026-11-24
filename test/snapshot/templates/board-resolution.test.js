import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImages, extractItems } from '../../helpers/pdfText.js';
import { assertGeometrySnapshot, fixtureInput, renderFixture, withExampleCtx } from '../../helpers/templateRender.js';

const ID = 'board-resolution';
const ML = 37.5;
const PW = 595.28;
const PH = 841.89;
const CW = PW - 75;
const find = (items, text) => items.find((i) => i.text === text) ?? assert.fail(`no item "${text}"`);
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('board resolution: byte-identical renders and geometry snapshot', () => withExampleCtx(async (ctx) => {
  const a = await renderFixture(ctx, ID, { number: null });
  const b = await renderFixture(ctx, ID, { number: null });
  assert.ok(a.pdf.equals(b.pdf), 'two renders differ');
  assert.equal(a.html, b.html);
  assert.equal(a.md, b.md);
  await assertGeometrySnapshot(ID, a.pdf);
}));

test('board resolution: legacy positions (DISCOVERY A8 §11)', () => withExampleCtx(async (ctx) => {
  const { pdf, md } = await renderFixture(ctx, ID, { number: null });
  const items = await extractItems(pdf);
  assert.deepEqual([...new Set(items.map((i) => i.page))], [1]);
  const title = find(items, 'BOARD RESOLUTION');
  assert.deepEqual([title.y, title.size, title.font], [100, 15, 'Manrope-ExtraBold']);
  near(title.x + title.width / 2, PW / 2, 'title centred (letter-spaced)', 1);
  const date = find(items, 'Date: 23/10/2026');
  assert.deepEqual([date.size, date.font], [9.5, 'Manrope-SemiBold']);
  near(date.x + date.width, PW - ML, 'date right-aligned');
  const preamble = items.find((i) => i.text.startsWith('CERTIFIED TRUE COPY OF THE EXTRACT'));
  assert.deepEqual([preamble.x, preamble.size, preamble.font], [ML, 9.5, 'Manrope-Bold']);
  assert.ok(items.some((i) => i.font === 'Manrope-Bold' && /^ACME EVENTS PRIVATE LIMITED HELD AT NO\. 0, PLACEHOLDER LANE/.test(i.text)));
  const resolved = find(items, 'RESOLVED:');
  assert.deepEqual([resolved.size, resolved.font], [10.5, 'Manrope-ExtraBold']);
  const para = items.find((i) => i.text.startsWith('THAT a current account'));
  assert.deepEqual([para.size, para.font], [9.5, 'Manrope-Regular']);
  // Director rows: bullet at ML+12, name SemiBold at ML+26, rows 40 apart, first row 4 pt below the paragraph end + 22.
  const names = items.filter((i) => i.text === 'Sam Sample' && i.font === 'Manrope-SemiBold' && i.x === ML + 26);
  assert.equal(names.length, 2, 'two lists');
  const second = items.filter((i) => i.text === 'Alex Example' && i.x === ML + 26);
  assert.equal(second[0].y, names[0].y + 40);
  assert.ok(items.some((i) => i.text === '•' && i.x === ML + 12 && i.y === names[0].y));
  // Certification: three columns (CW - 48) / 3 wide, 24 apart; names SemiBold 9.5 at certY + 15 + 84 + 7, sub 8.5 at +21.
  const cert = find(items, 'CERTIFIED TRUE COPY');
  assert.deepEqual([cert.x, cert.size, cert.font], [ML, 9.5, 'Manrope-Bold']);
  const forLine = find(items, 'For ACME EVENTS PRIVATE LIMITED');
  assert.deepEqual([forLine.y, forLine.size], [cert.y + 15, 9.5]);
  const colW = (CW - 48) / 3;
  const sealCol = find(items, 'Company Seal');
  assert.equal(sealCol.y, cert.y + 15 + 84 + 7);
  near(sealCol.x + sealCol.width / 2, ML + 2 * (colW + 24) + colW / 2, 'seal column centred');
  const c1 = items.filter((i) => i.text === 'Sam Sample').at(-1);
  near(c1.x + c1.width / 2, ML + colW / 2, 'first certifier centred');
  const role = find(items, 'Managing Director');
  assert.deepEqual([role.y, role.size], [c1.y + 14, 8.5]);
  // Footer: centre text only, no page number; letterhead logo.
  const conf = find(items, 'Confidential');
  near(conf.y, PH - 39 + 8, 'footer at PH - MB + 8');
  near(conf.x + conf.width / 2, PW / 2, 'confidential centred');
  assert.equal(items.some((i) => /^Page /.test(i.text) || i.text === 'hello@example.com | www.example.com'), false);
  assert.equal((await extractImages(pdf)).length, 1, 'letterhead logo only');
  assert.match(md, /^# BOARD RESOLUTION/);
  assert.match(md, /- \*\*Alex Example\*\* \(Director\)/);
}));

test('board resolution: numbered, certifiers, wording from input; bad directors are field errors', () => withExampleCtx(async (ctx) => {
  const input = {
    ...fixtureInput(ID),
    directors: [...fixtureInput(ID).directors, { name: 'Jordan Placeholder', role: 'Director' }],
    certifiers: ['Jordan Placeholder'],
    resolutions: [{ text: 'THAT {bank} be informed.' }, { text: 'THAT these directors sign:', directors: true }],
  };
  const { pdf } = await renderFixture(ctx, ID, { input, number: 'ACM-DOC-2026-0001' });
  const items = await extractItems(pdf);
  const ref = find(items, 'Ref: ACM-DOC-2026-0001');
  assert.equal(ref.x, ML);
  assert.equal(ref.y, find(items, 'Date: 23/10/2026').y);
  assert.ok(find(items, 'THAT Example Bank Limited be informed.'));
  assert.equal(items.filter((i) => i.x === ML + 26).length, 3, 'one list of three directors');
  assert.ok(find(items, 'Company Seal'));
  assert.equal(items.filter((i) => i.text === 'Jordan Placeholder').length, 2);

  const { getTemplate } = await import('../../../src/services/templates.js');
  const { resolveTemplateFields } = await import('../../../src/services/fields.js');
  const t = await getTemplate(ctx, ID);
  const bad = resolveTemplateFields(ctx, t, { ...fixtureInput(ID), directors: [{ role: 'Director' }], certifiers: ['Nobody'] }, { brandId: 'acme' });
  assert.deepEqual(bad.errors.map((e) => e.name), ['directorList', 'certifierList']);
  const unknown = resolveTemplateFields(ctx, t, { ...fixtureInput(ID), certifiers: ['Nobody'] }, { brandId: 'acme' });
  assert.match(unknown.errors[0].message, /"Nobody" is not one of the directors/);
}));
