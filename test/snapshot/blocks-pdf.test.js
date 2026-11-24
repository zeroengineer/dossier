import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { EXAMPLE_WORKSPACE } from '../../src/paths.js';
import { loadWorkspace } from '../../src/workspace/index.js';
import * as R from '../../src/render/pdf/index.js';
import { extractItems } from '../helpers/pdfText.js';
import { BLOCK_DOC, PARAGRAPH } from '../fixtures/blockDoc.js';

sharp.cache(false);
const ws = loadWorkspace(EXAMPLE_WORKSPACE);
const info = { title: 'Blocks', creationDate: '2026-01-01T00:00:00Z' };
const LH = 1.366;
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

async function letter(draw) {
  const ctx = await R.createPdf({ profileId: 'letter', brand: 'acme', ws, info });
  await R.attachLetterhead(ctx);
  await draw(ctx);
  return extractItems(await R.finalizePdf(ctx));
}

const FLOW = BLOCK_DOC.slice(0, 6); // headings 1-2, paragraph, bullets, numbered, table
const TABLE = FLOW[5];

test('renderBlocksPdf lays out headings, paragraph, bullets and table exactly like the offer-letter primitives', async () => {
  const viaBlocks = await letter((ctx) => R.renderBlocksPdf(ctx, FLOW));
  const manual = await letter((ctx) => {
    const { doc, palette, profile } = ctx;
    doc.addPage();
    R.sectionHeader(ctx, 'Terms of engagement');
    R.clauseHeader(ctx, '1. Scope & <duties>');
    R.richText(ctx, PARAGRAPH);
    R.richBullets(ctx, FLOW[3].items);
    // numbered list: markers at ML, text at ML + 18
    FLOW[4].items.forEach((item, i) => {
      const y = doc.y;
      doc.font('BodyRegular').fontSize(10.5).fillColor(palette.body).text(`${i + 1}.`, profile.ML, y, { width: 18, lineBreak: false });
      doc.y = y;
      R.renderParagraph(ctx, item, profile.ML + 18, profile.CW - 18, { moveDown: 0.35 });
    });
    doc.moveDown(0.45);
    doc.moveDown(0.35);
    const bottom = R.drawTable(ctx, {
      y: doc.y,
      columns: [{ key: 'a', label: 'Earnings', width: 200 }, { key: 'b', label: 'Monthly', width: 150, align: 'right' }, { key: 'c', label: 'Annual', align: 'right' }],
      rows: TABLE.rows.map(([a, b, c]) => ({ a, b, c })),
      totalRows: TABLE.totalRows.map(([a, b, c]) => ({ a, b, c })),
    });
    doc.y = bottom;
  });
  assert.deepEqual(viaBlocks, manual);
});

test('block geometry: offer-letter sizes, fonts and positions', async () => {
  const items = await letter((ctx) => R.renderBlocksPdf(ctx, FLOW));
  const find = (text) => items.find((i) => i.text.startsWith(text)) ?? assert.fail(`no item "${text}"`);
  const ML = 37.5;
  const top = 100 + 10; // MT + CP

  const h1 = find('TERMS OF ENGAGEMENT');
  assert.equal(h1.size, 17);
  assert.equal(h1.font, 'Manrope-Bold');
  assert.equal(h1.x, ML);
  near(h1.y, top + 0.5 * 8 * LH, 'h1 below moveDown(0.5) of the letterhead font');

  const h2 = find('1. Scope');
  assert.equal(h2.size, 12);
  near(h2.y, h1.y + 17 * LH + 2 + 0.65 * 17 * LH + 0.35 * 17 * LH, 'h2 after h1 line + lineGap + after/before');

  const p = find('This letter sets out');
  assert.equal(p.size, 10.5);
  assert.equal(p.font, 'Manrope-Regular');
  assert.equal(p.x, ML);
  const bold = find('terms');
  assert.equal(bold.font, 'Manrope-Bold');
  const pLines = [...new Set(items.filter((i) => i.size === 10.5 && i.y >= p.y && i.y < find('•').y).map((i) => i.y))];
  assert.ok(pLines.length >= 3, 'paragraph wraps');
  near(pLines[1] - pLines[0], 10.5 * LH + 4.5, 'paragraph line pitch = line height + lineGap 4.5');

  const bullet = items.filter((i) => i.text === '•');
  assert.equal(bullet.length, 2);
  assert.equal(bullet[0].x, ML + 5);
  assert.equal(find('First item').x, ML + 5 + 14);
  assert.equal(find('1.').x, ML);
  assert.equal(find('Step one').x, ML + 18);

  const header = find('Earnings');
  assert.equal(header.size, 9.5);
  assert.equal(header.font, 'Manrope-Bold');
  assert.equal(header.x, ML + 10);
  const basic = find('Basic');
  near(basic.y - header.y, 22, 'row height 22');
  const gross = find('Gross');
  assert.equal(gross.font, 'Manrope-Bold');
  near(gross.y - basic.y, 44, 'total row after two rows');
  const annual = find('1,44,000');
  near(annual.x + annual.width, 595.28 - 37.5 - 10, 'right-aligned values end padX inside the table', 1);
});

test('every block type renders; custom blocks use the template draw function; cover headings centre', async () => {
  let customData;
  const items = await letter((ctx) => R.renderBlocksPdf(ctx, [
    { type: 'heading', level: 1, text: 'Cover title', cover: true },
    ...BLOCK_DOC.slice(6),
  ], {}, { custom: { box: (c, data) => { customData = data; c.doc.rect(c.profile.ML, c.doc.y, 20, 5).fill(data.fill); } } }));
  assert.deepEqual(customData, BLOCK_DOC.at(-1).data);
  const cover = items.find((i) => i.text === 'COVER TITLE');
  near(cover.x + cover.width / 2, 595.28 / 2, 'cover heading centred', 1);
  const pages = new Set(items.map((i) => i.page));
  assert.deepEqual([...pages], [1, 2], 'pageBreak starts page 2');
  const label = items.find((i) => i.text === 'Event');
  const value = items.find((i) => i.text.includes('Example Annual Meet'));
  assert.equal(label.x, 37.5);
  assert.equal(value.x, 37.5 + 130);
  assert.equal(items.find((i) => i.text === 'Sam Sample').page, 2);
  assert.ok(items.find((i) => i.text === 'Authorized Signatory'));
  assert.ok(items.find((i) => i.text === 'For Example Client Org'));
  const centred = items.find((i) => i.text === 'Centred line');
  near(centred.x + centred.width / 2, 595.28 / 2, 'centred paragraph', 1);
});

test('style overrides apply (sizes, colours by palette key) and unknown custom blocks throw', async () => {
  const items = await letter((ctx) => R.renderBlocksPdf(ctx, [{ type: 'heading', level: 1, text: 'Big' }, { type: 'paragraph', text: 'Small' }],
    { heading: { 1: { size: 22, font: 'ExtraBold', uppercase: false } }, paragraph: { fontSize: 9, color: 'muted' } }));
  const big = items.find((i) => i.text === 'Big');
  assert.equal(big.size, 22);
  assert.equal(big.font, 'Manrope-ExtraBold');
  assert.equal(items.find((i) => i.text === 'Small').size, 9);
  const ctx = await R.createPdf({ profileId: 'letter', brand: 'acme', ws, info });
  await assert.rejects(R.renderBlocksPdf(ctx, [{ type: 'custom', name: 'nope' }]), /no PDF draw function for custom block "nope"/);
});
