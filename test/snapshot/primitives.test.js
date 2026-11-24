import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { EXAMPLE_WORKSPACE, FONTS_DIR } from '../../src/paths.js';
import { loadWorkspace } from '../../src/workspace/index.js';
import * as R from '../../src/render/pdf/index.js';
import { extractImages, extractItems } from '../helpers/pdfText.js';
import { tmpDir } from '../helpers/tmp.js';
import { minimalBrand, writeWorkspace } from '../helpers/workspace.js';

sharp.cache(false);
const PDFDocument = createRequire(import.meta.url)('pdfkit');
const SNAPSHOT = join(import.meta.dirname, '__snapshots__', 'primitives.json');
const ws = loadWorkspace(EXAMPLE_WORKSPACE);
const near = (a, b, tol = 0.5, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} not within ${tol} of ${b}`);

const PARAGRAPH = 'This agreement is made between the parties named above and sets out the **terms of engagement**, the '
  + 'schedule of deliverables, the fees payable and the obligations of each party for the duration of the engagement. '
  + 'Each party confirms that it has read and understood these terms and agrees to be bound by them in full.';

/** A letter that exercises every primitive (fake brand only). */
async function renderSample({ watermark = false, centerStyle } = {}) {
  const ctx = await R.createPdf({
    profileId: 'letter', brand: 'acme', ws,
    info: { title: 'Primitives sample', author: 'Acme', creationDate: '2026-01-01T00:00:00Z' },
  });
  await R.attachLetterhead(ctx);
  const { doc } = ctx;
  doc.addPage();
  R.sectionHeader(ctx, 'Terms of engagement');
  R.clauseHeader(ctx, '1. Scope');
  R.richText(ctx, PARAGRAPH);
  R.richBullets(ctx, ['First item with **bold** words', 'Second item']);
  R.divider(ctx);
  const tableTop = doc.y + 12;
  const val = { font: 'BodyMedium', color: ctx.palette.ink, align: 'right' };
  const tableBottom = R.drawTable(ctx, {
    y: tableTop,
    columns: [{ key: 'a', label: 'Earnings', width: 200 }, { key: 'b', label: 'Monthly', width: 150, ...val }, { key: 'c', label: 'Annual', ...val }],
    rows: [{ a: 'Basic', b: ctx.fmt.number(1000000, { decimals: 0 }), c: ctx.fmt.number(12000000, { decimals: 0 }) }],
    totalRows: [{ a: 'Gross', b: '10,000', c: '1,20,000' }],
  });
  doc.addPage();
  R.richText(ctx, `Amount: ${ctx.fmt.money(12000000, { decimals: 0 })} (${ctx.fmt.amountInWords(12000000)}).`, { align: 'left' });
  const sig = await R.drawSignatureBlock(ctx, {
    y: doc.y + 20, signatoryId: 'md',
    extraLines: [{ text: 'Authorized Signatory', dy: 26, font: 'Regular', size: 9 }],
  });
  R.drawFooters(ctx, centerStyle ? { centerStyle } : {});
  if (watermark) R.drawWatermark(ctx, { text: 'DRAFT — NOT NUMBERED' });
  return { buffer: await R.finalizePdf(ctx), ctx, tableTop, tableBottom, sig };
}

const sample = renderSample();
after(() => sample);

test('same input renders byte-identical PDFs', async () => {
  const a = (await sample).buffer;
  R.clearImageCache();
  const { buffer: b } = await renderSample();
  assert.ok(a.equals(b), 'two renders differ');
  assert.match(a.subarray(0, 8).toString('latin1'), /^%PDF-1\./);
  const text = a.toString('latin1');
  const info = (key) => {
    const ref = new RegExp(`/${key} (\\d+) 0 R`).exec(text)?.[1];
    return new RegExp(`\\n${ref} 0 obj\\n\\((.*?)\\)\\nendobj`).exec(text)?.[1];
  };
  assert.equal(info('Producer'), 'Dossier');
  assert.equal(info('Creator'), 'Dossier');
  assert.equal(info('CreationDate'), 'D:20260101000000Z');
  assert.equal(info('ModDate'), 'D:20260101000000Z');
  assert.equal(info('Title'), 'Primitives sample');
  assert.equal(text.match(/\/Rotate 0/g)?.length, 2);
});

test('letterhead: legal name right-aligned at the vertically centred text block, logo at LOGO_H', async () => {
  const { buffer, ctx } = await sample;
  const { ML, MR, MT, PW, LOGO_H } = ctx.profile;
  const m = new PDFDocument({ autoFirstPage: false });
  m.registerFont('B', join(FONTS_DIR, 'Manrope', 'Manrope-Bold.ttf'));
  m.registerFont('R', join(FONTS_DIR, 'Manrope', 'Manrope-Regular.ttf'));
  const lhB = m.font('B').fontSize(8.5).currentLineHeight(true);
  const lhR = m.font('R').fontSize(8).currentLineHeight(true);
  const blockH = lhB + 1 + 4 * lhR + 1.5;
  const textY = (MT - blockH) / 2;

  const items = await extractItems(buffer);
  for (const page of [1, 2]) {
    const name = items.find((i) => i.page === page && i.text === 'Acme Events Private Limited');
    assert.ok(name, `legal name on page ${page}`);
    assert.equal(name.font, 'Manrope-Bold');
    assert.equal(name.size, 8.5);
    near(name.x + name.width, PW - MR, 0.5, 'right edge');
    near(name.y, textY, 0.5, 'name y');
    const lines = items.filter((i) => i.page === page && i.size === 8 && i.y < MT);
    assert.deepEqual(lines.map((i) => i.text), ['CIN: U00000XX2000PTC000000', 'Unit 000, Example Business Park, 1 Sample Road',
      'Example City, Example State 000000, India', 'Email: hello@example.com | www.example.com']);
    assert.ok(lines.every((i) => i.font === 'Manrope-Regular'));
    near(lines.at(-1).y, textY + lhB + 1 + 3 * (lhR + 0.5), 0.5, 'last line y');
  }
  const logo = (await extractImages(buffer)).find((i) => i.page === 1 && i.x === ML);
  near(logo.height, LOGO_H, 0.5, 'logo height');
  near(logo.y, textY + (blockH - LOGO_H) / 2, 0.5, 'logo y');
  near(logo.width, LOGO_H * 1027 / 234, 0.5, 'logo width from aspect ratio');
});

test('footer: rule zone text at PH-MB+8 with brand slots and page numbers', async () => {
  const { buffer, ctx } = await sample;
  const { ML, MR, MB, PW, PH, CW } = ctx.profile;
  const items = await extractItems(buffer);
  const footY = PH - MB + 8;
  for (const page of [1, 2]) {
    const foot = items.filter((i) => i.page === page && Math.abs(i.y - footY) <= 0.5);
    assert.deepEqual(foot.map((i) => i.text), ['hello@example.com | www.example.com', 'Confidential', `Page ${page} of 2`]);
    assert.ok(foot.every((i) => i.size === 7.5 && i.font === 'Manrope-Regular'));
    near(foot[0].x, ML);
    near(foot[1].x + foot[1].width / 2, ML + CW / 2, 0.5, 'centre');
    near(foot[2].x + foot[2].width, PW - MR, 0.5, 'right');
  }
});

test('footer caps style prints the centre slot upper-case in SemiBold', async () => {
  const { buffer } = await renderSample({ centerStyle: 'caps' });
  const caps = (await extractItems(buffer)).filter((i) => i.text.replace(/\s/g, '') === 'CONFIDENTIAL');
  assert.equal(caps.length, 2);
  assert.ok(caps.every((i) => i.font === 'Manrope-SemiBold'));
});

test('justified paragraph lines span exactly CW; the last line is ragged', async () => {
  const { buffer, ctx } = await sample;
  const { ML, CW } = ctx.profile;
  const items = await extractItems(buffer);
  const body = items.filter((i) => i.page === 1 && i.size === 10.5 && i.y > 150 && i.y < 260);
  const lines = [...Map.groupBy(body, (i) => i.y).values()];
  assert.ok(lines.length >= 3, `expected a multi-line paragraph, got ${lines.length}`);
  for (const line of lines.slice(0, -1)) {
    near(Math.min(...line.map((i) => i.x)), ML, 0.5, 'line start');
    near(Math.max(...line.map((i) => i.x + i.width)), ML + CW, 1, 'line end');
  }
  const last = lines.at(-1);
  assert.ok(Math.max(...last.map((i) => i.x + i.width)) < ML + CW - 20, 'last line not justified');
  assert.ok(body.some((i) => i.font === 'Manrope-Bold' && i.text.includes('terms of engagement')), 'bold run');
});

test('table rows are 22pt with header text at +5; total row in bold', async () => {
  const { buffer, tableTop, tableBottom } = await sample;
  assert.equal(tableBottom, tableTop + 3 * 22);
  const items = await extractItems(buffer);
  const header = items.find((i) => i.text === 'Earnings');
  near(header.y, tableTop + 5);
  assert.equal(header.font, 'Manrope-Bold');
  const gross = items.find((i) => i.text === 'Gross');
  near(gross.y, tableTop + 44 + 5);
  assert.equal(gross.font, 'Manrope-Bold');
  assert.equal(items.find((i) => i.text === 'Basic').font, 'Manrope-Regular');
  assert.equal(items.find((i) => i.text === '10,000' && i.y < tableTop + 44).font, 'Manrope-Medium');
});

test('signature block: image sized from its aspect ratio, name and title offsets, seal', async () => {
  const { buffer, sig, ctx } = await sample;
  const items = await extractItems(buffer);
  const name = items.find((i) => i.page === 2 && i.text === 'Sam Sample');
  near(name.y, sig.imageY + 55 + 22);
  assert.equal(name.size, 10);
  const title = items.find((i) => i.page === 2 && i.text === 'Managing Director');
  near(title.y, sig.nameY + 14);
  assert.equal(title.font, 'Manrope-Medium');
  near(items.find((i) => i.page === 2 && i.text === 'Authorized Signatory').y, sig.nameY + 26);
  assert.ok(items.some((i) => i.page === 2 && i.text === 'FOR Acme Events Private Limited'));
  const images = (await extractImages(buffer)).filter((i) => i.page === 2);
  const signature = images.find((i) => i.x === ctx.profile.ML && i.height === 55);
  near(signature.width, 55 * 5914 / 4873, 0.5, 'signature width');
  assert.equal(images.length, 3, 'logo, signature and seal');
});

test('signature-large falling back to a compact image keeps the compact aspect ratio', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const sign = await sharp({ create: { width: 1024, height: 406, channels: 4, background: '#123456' } }).png().toBuffer();
    writeWorkspace(dir, {
      brands: { acme: minimalBrand('acme', { signatories: [{ id: 'ops', name: 'Alex Example', title: 'Operations', signature: 'assets/sign.png' }] }) },
      files: { 'brands/acme/assets/sign.png': sign },
    });
    const w = loadWorkspace(dir);
    const ctx = await R.createPdf({ profileId: 'letter', brand: 'acme', ws: w, info: { title: 't', creationDate: new Date(0) } });
    ctx.doc.addPage();
    await R.drawSignatureBlock(ctx, { y: 200, signatoryId: 'ops', seal: null, forLine: '' });
    const [img] = await extractImages(await R.finalizePdf(ctx));
    near(img.width, 55 * 1024 / 406, 0.5, 'width');
    near(img.height, 55);
  } finally {
    cleanup();
  }
});

test('watermark is vector text on every page', async () => {
  const { buffer } = await renderSample({ watermark: true });
  const marks = (await extractItems(buffer)).filter((i) => i.text === 'DRAFT — NOT NUMBERED');
  assert.deepEqual(marks.map((i) => i.page), [1, 1, 1, 2, 2, 2]);
});

test('geometry snapshot (UPDATE_SNAPSHOTS=1 rewrites it)', async () => {
  const items = await extractItems((await sample).buffer);
  const images = await extractImages((await sample).buffer);
  const current = { items, images };
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(SNAPSHOT)) {
    writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 1)}\n`);
  }
  assert.deepEqual(current, JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
});
