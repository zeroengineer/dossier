import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import sharp from 'sharp';
import { FONTS_DIR } from '../../src/paths.js';
import { loadWorkspace } from '../../src/workspace/index.js';
import * as R from '../../src/render/pdf/index.js';
import { extractItems } from '../helpers/pdfText.js';
import { tmpDir } from '../helpers/tmp.js';
import { minimalBrand, writeWorkspace } from '../helpers/workspace.js';

sharp.cache(false);
const PDFDocument = createRequire(import.meta.url)('pdfkit');
const near = (a, b, tol = 0.5, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} not within ${tol} of ${b}`);

async function withWorkspace(brandExtra, fn, workspace) {
  const { dir, cleanup } = tmpDir();
  try {
    writeWorkspace(dir, { brands: { acme: minimalBrand('acme', brandExtra) }, ...(workspace ? { workspace } : {}) });
    return await fn(loadWorkspace(dir));
  } finally {
    cleanup();
  }
}

const newCtx = (ws, profileId = 'letter') => R.createPdf({ profileId, brand: 'acme', ws, info: { title: 't', creationDate: new Date(0) } });

test('letterhead block height follows the number of brand lines; contact placeholders resolve', async () => {
  await withWorkspace({
    letterhead: { lines: ['Reg: {registrations.0.value}', 'Mail: {contact.email}'] },
    registrations: [{ label: 'CIN', value: 'U00000XX2000PTC000000' }],
    contacts: { default: { email: 'hello@example.com' }, hr: { email: 'hr@example.com' } },
    layoutProfiles: { letter: { ML: 42, MR: 42 } },
    palette: { ink: '#112233' },
  }, async (ws) => {
    const ctx = await newCtx(ws);
    await R.attachLetterhead(ctx, { contact: 'hr' });
    ctx.doc.addPage();
    const startY = ctx.doc.y;
    const items = await extractItems(await R.finalizePdf(ctx));
    const m = new PDFDocument({ autoFirstPage: false });
    m.registerFont('B', join(FONTS_DIR, 'Manrope', 'Manrope-Bold.ttf'));
    m.registerFont('R', join(FONTS_DIR, 'Manrope', 'Manrope-Regular.ttf'));
    const h = m.font('B').fontSize(8.5).currentLineHeight(true) + 1 + 2 * m.font('R').fontSize(8).currentLineHeight(true) + 0.5;
    const name = items.find((i) => i.text === 'Acme Events Private Limited');
    near(name.y, (100 - h) / 2);
    near(name.x + name.width, 595.28 - 42);
    assert.deepEqual(items.filter((i) => i.size === 8).map((i) => i.text), ['Reg: U00000XX2000PTC000000', 'Mail: hr@example.com']);
    assert.equal(startY, 110, 'content starts at MT + CP');
  });
});

test('richText / richBullets: page breaks at PH - MB - CP and bullets at ML + 5 with indent 14', async () => {
  await withWorkspace({}, async (ws) => {
    const ctx = await newCtx(ws);
    ctx.doc.addPage();
    R.richBullets(ctx, ['alpha **beta**', 'gamma']);
    ctx.doc.y = 841.89 - 39 - 10 - 5;
    R.richText(ctx, 'line that must move to the next page');
    const items = await extractItems(await R.finalizePdf(ctx));
    const bullets = items.filter((i) => i.text === '•');
    assert.equal(bullets.length, 2);
    near(bullets[0].x, 37.5 + 5);
    near(items.find((i) => i.text.startsWith('alpha')).x, 37.5 + 5 + 14);
    assert.equal(items.find((i) => i.text === 'beta').font, 'Manrope-Bold');
    assert.equal(items.find((i) => i.text.startsWith('line that')).page, 2);
  });
});

test('amountEmphasis draws currency words in ExtraBold, 0.5pt larger, 0.3pt higher', async () => {
  await withWorkspace({}, async (ws) => {
    const ctx = await newCtx(ws, 'mou');
    ctx.doc.addPage();
    ctx.doc.y = 100;
    R.richText(ctx, 'Fee of ₹10,000 payable', { fontSize: 10.2, lineGap: 5.6, amountEmphasis: true, regularFont: 'Regular', boldFont: 'Bold' });
    const items = await extractItems(await R.finalizePdf(ctx));
    const amount = items.find((i) => i.text === '₹10,000');
    const plain = items.find((i) => i.text.startsWith('Fee'));
    assert.equal(amount.font, 'Manrope-ExtraBold');
    assert.equal(amount.size, 10.5);
    near(plain.y, 100);
    near(amount.y, 99.5, 0.5);
  });
});

test('drawTable auto height, rules, page break with repeated header', async () => {
  await withWorkspace({}, async (ws) => {
    const ctx = await newCtx(ws);
    ctx.doc.addPage();
    const cols = [{ key: 'a', label: 'Item', width: 200 }, { key: 'b', label: 'Amount', align: 'right' }];
    const long = 'word '.repeat(60).trim();
    const bottom = R.drawTable(ctx, { y: 120, columns: cols, rows: [{ a: long, b: '1' }], row: { height: 'auto', padY: 6, lineGap: 2, rule: { color: '#cccccc' } } });
    assert.ok(bottom - 120 - 22 > 60, 'auto row grew with its text');
    const end = R.drawTable(ctx, { y: 740, columns: cols, rows: [{ a: 'x', b: '1' }, { a: 'y', b: '2' }, { a: 'z', b: '3' }] });
    assert.equal(end, ctx.profile.MT + 22 + 22 * 2, 'rows y and z on page 2 under a repeated header (no letterhead: top is MT)');
    const end2 = R.drawTable(ctx, { y: 775, columns: cols, rows: [{ a: 'q', b: '4' }] });
    assert.equal(end2, ctx.profile.MT + 44, 'header not orphaned: the table moved to page 3');
    const items = await extractItems(await R.finalizePdf(ctx));
    assert.deepEqual(items.filter((i) => i.text === 'Item').map((i) => i.page), [1, 1, 2, 3]);
    assert.deepEqual(['x', 'y', 'z', 'q'].map((t) => items.find((i) => i.text === t).page), [1, 2, 2, 3]);
  });
});

test('divider skips near the bottom with onBreak "skip" and breaks the page by default', async () => {
  await withWorkspace({}, async (ws) => {
    const ctx = await newCtx(ws);
    ctx.doc.addPage();
    ctx.doc.y = 700;
    R.divider(ctx, { breakMin: 110, onBreak: 'skip' });
    assert.equal(ctx.doc.y, 700);
    assert.equal(ctx.pageNumber, 1);
    R.divider(ctx, { breakMin: 110 });
    assert.equal(ctx.pageNumber, 2);
    await R.finalizePdf(ctx);
  });
});

test('footer slots: empty strings skip, {page}/{pages} fill, defaults from brand.footer', async () => {
  await withWorkspace({ footer: { left: '{contact.email}', center: '', right: 'Page {page} of {pages}' } }, async (ws) => {
    const ctx = await newCtx(ws);
    ctx.doc.addPage();
    ctx.doc.addPage();
    R.drawFooters(ctx, { right: '{page}/{pages}' });
    const items = await extractItems(await R.finalizePdf(ctx));
    assert.deepEqual(items.map((i) => [i.page, i.text, i.y]), [[1, 'hello@example.com', 811], [1, '1/2', 811], [2, 'hello@example.com', 811], [2, '2/2', 811]]);
  });
});

test('createPdf validates its input and exposes brand strings through t()', async () => {
  await withWorkspace({ strings: { forCompany: 'For {legalName}', hello: 'Hi {name}' } }, async (ws) => {
    await assert.rejects(R.createPdf({ profileId: 'letter', brand: 'nope', ws, info: { title: 't', creationDate: new Date(0) } }), /unknown brand/);
    await assert.rejects(R.createPdf({ profileId: 'letter', brand: 'acme', ws, info: { title: 't', creationDate: 'x' } }), /creationDate/);
    await assert.rejects(R.createPdf({ profileId: 'letter', brand: 'acme', ws, info: { creationDate: new Date(0) } }), /title/);
    const ctx = await newCtx(ws);
    assert.equal(ctx.t('forCompany'), 'For Acme Events Private Limited');
    assert.equal(ctx.t('hello', { name: 'Ana' }), 'Hi Ana');
    assert.equal(ctx.t('missing'), '');
    assert.equal(ctx.fmt.money(100, { space: true }), '₹ 1.00');
    assert.equal(ctx.palette.ink, '#1a1a1a');
    ctx.doc.addPage();
    await R.finalizePdf(ctx);
  });
});

test('review fixes: bullet glyph 10.5 regardless of fontSize, watermark ignores undefined, seal options merge', async () => {
  await withWorkspace({}, async (ws) => {
    const ctx = await newCtx(ws);
    ctx.doc.addPage();
    R.richBullets(ctx, ['small text'], { fontSize: 9 });
    const seal = await ctx.assets.seal({ resizeWidth: 300 });
    assert.equal(seal.width, 300);
    R.drawWatermark(ctx, { text: 'MARK', size: undefined, rows: undefined });
    const items = await extractItems(await R.finalizePdf(ctx));
    assert.equal(items.find((i) => i.text === '•').size, 10.5);
    assert.equal(items.find((i) => i.text === 'small text').size, 9);
    const marks = items.filter((i) => i.text === 'MARK');
    assert.equal(marks.length, 3);
    assert.ok(marks.every((i) => i.size === 38));
  });
});
