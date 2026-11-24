// Statement and settlement pages drawn by absolute position, ported from the legacy scripts (docs/DISCOVERY.md A8 §6
// employee final settlement on the letterhead (6b, tables as 6a), §7 ticketing & settlement statement, §7b client final
// settlement, §8 remittance statement, §10 expense statement). Each draw function takes a model of already formatted
// strings (src/render/statementTemplate.js builds it from the values, params and brand) and a frame: the legacy
// offsets, sizes and colours below, deep-merged with the template's `params.frame`. Colours are palette keys or hex.
import { mergeStyle, paletteColour, inlineRuns } from '../blocks.js';
import { onPageAdded } from './document.js';
import { drawFooters } from './footer.js';
import { placeImage } from './images.js';
import { drawLetterhead, LETTERHEAD_DEFAULTS } from './letterhead.js';
import { drawSignatureBlock } from './signature.js';
import { renderParagraph } from './text.js';

/** Employee final settlement (A8 §6b): title at rule+16, meta grid at rule+54, boxed two-column tables, net box, sign row. */
export const EMPLOYEE_SETTLEMENT_FRAME = Object.freeze({
  title: { dy: 16, font: 'ExtraBold', size: 14.5, color: 'ink' },
  meta: {
    dy: 54, rowGap: 24, after: 14, labelX: 0, valueX: 115, col2X: 305, col2ValueDx: 85,
    label: { font: 'Bold', size: 9.5, color: 'ink' }, value: { font: 'Medium', size: 9.5, color: '#2d3748' },
  },
  table: {
    valueWidth: 150, headerH: 28, rowH: 26, headerFill: '#f8f9fa', border: '#e2e8f0', borderWidth: 0.6, ruleWidth: 0.5,
    title: { font: 'Bold', size: 10, color: 'ink', dx: 10, dy: 8.5 }, altFill: '#fafafa', textDx: 10, textDy: 7.5,
    label: { font: 'Regular', size: 9.5, color: '#2d3748' }, strong: '#111827', valueFont: 'SemiBold', valuePad: 8, valueInset: 18,
    labelInset: 18, bullet: '•  ', after: 20,
  },
  net: {
    height: 50, fill: '#000000', fillOpacity: 0.015, stroke: '#4b5563', strokeWidth: 0.8, after: 12,
    label: { font: 'Bold', size: 10.5, color: '#111827', dx: 10, dy: 10 },
    note: { font: 'Medium', size: 9, color: '#6b7280', dx: 10, dy: 28 },
    amount: { font: 'Bold', size: 12, color: '#111827', dy: 18 },
  },
  declaration: { gap: 6, title: { font: 'Bold', size: 10, color: '#111827' }, textDy: 15, text: { font: 'Regular', size: 9.5, color: '#4b5563', lineGap: 3.5 } },
  signRow: {
    lineY: 755, widths: [150, 100, 150], lineColor: '#4b5563', lineWidth: 0.75,
    label: { font: 'Bold', size: 9.5, color: '#111827', dy: 9 }, date: { font: 'Bold', size: 10, color: '#111827', dy: -16 },
    imageHeight: 46, imageGap: 3, clearance: 6,
  },
});

/** Ticketing & settlement statement (A8 §7, both legacy variants). Title and meta are repeated on every page in a post-pass. */
export const TICKETING_FRAME = Object.freeze({
  contentDy: 125,
  head: {
    titleY: 101, ruleY: 134, title: { font: 'ExtraBold', size: 16.5, color: 'ink' }, rule: '#e2e8f0', ruleWidth: 0.5,
    metaDy: 10, colGap: 20, labelW: 60, valueDx: 65, minLine: 14, lineGap: 6, rightStep: 19,
    label: { font: 'Regular', size: 10, color: 'label' }, value: { font: 'Medium', size: 10, color: 'ink' },
  },
  section: { breakMin: 40, before: 0.2, height: 24, fill: 'section', font: 'Bold', size: 10, color: 'white', dx: 8, dy: 7, after: 12 },
  table: {
    headH: 26, rowH: 25, pad: 8, headDy: 10, rowDy: 8, gapAfterHead: 4, gapBeforeTotal: 4, after: 15,
    head: { font: 'Bold', size: 8, color: 'label' }, headRule: 'ink', headRuleWidth: 0.8,
    row: { font: 'Regular', size: 9, color: 'body' }, fills: ['#f9f9f9', '#ffffff'], rule: '#e2e8f0', ruleWidth: 0.5,
    total: { font: 'Bold', size: 9, color: 'ink', fill: 'fillTotal' }, totalRule: 'ink', totalRuleWidth: 0.8,
  },
  charges: {
    breakMin: 170, pad: 14, barW: 3, lineH: 20, radius: 4, fill: '#f7f7f7', bar: 'section', after: 18,
    title: { font: 'Bold', size: 11, color: 'ink', after: 24 }, line: { font: 'Regular', size: 9.5, color: 'label' },
    rule: '#e2e8f0', ruleWidth: 0.6, total: { font: 'Bold', size: 10.5, color: 'ink' },
  },
  final: {
    breakMin: 130, height: 70, fill: '#f7f7f7', stroke: 'section', lineWidth: 0.8, after: 18,
    label: { font: 'Bold', size: 10.5, color: 'ink', dy: 14 }, amount: { font: 'ExtraBold', size: 20, color: 'ink', dy: 34 },
  },
  acknowledgement: {
    breakMin: 200, text: { font: 'Regular', size: 9.5, color: 'body', lineGap: 3 },
    fieldsDy: 45, labelW: 100, colInset: 20, field: { font: 'Regular', size: 9.5, color: 'label' }, lineDy: 11, line: '#bbbbbb', lineWidth: 0.5,
  },
});

/** Client final settlement (A8 §7b): title block on page 1, slate section bars, auto-height rows, total box, note, footnote. */
export const CLIENT_SETTLEMENT_FRAME = Object.freeze({
  head: {
    titleY: 101, ruleY: 138, title: { font: 'ExtraBold', size: 16, color: 'ink' }, rule: '#e2e8f0', ruleWidth: 0.5,
    metaDy: 10, colGap: 20, labelW: 60, valueDx: 65, minLine: 12, lineGap: 6, lineGapText: 3.5,
    rightLabelW: 65, rightValueDx: 70, rightStep: 18, after: 12,
    label: { font: 'Regular', size: 8.5, color: 'label' }, value: { font: 'Medium', size: 8.5, color: 'ink' },
  },
  section: { breakMin: 32, before: 0.15, height: 20, fill: 'section', font: 'Bold', size: 9.5, color: 'white', dx: 8, dy: 5.5, after: 8 },
  table: {
    pad: 4, cellPad: 8, size: 9, lineGap: 3.5, headColor: 'label', color: 'body', fills: ['#f9f9f9', '#ffffff'], strong: '#e2e8f0',
    headRule: 'ink', headRuleWidth: 0.8, rule: '#e2e8f0', ruleWidth: 0.5, detailsLabelW: 140, amountW: 120,
    afterDetails: 35, afterFees: 12, afterExpenses: 18, afterSummary: 18,
  },
  total: {
    height: 75, fill: 'fillPanel', stroke: 'section', strokeWidth: 0.8, after: 8,
    label: { font: 'Bold', size: 10.5, color: 'ink', dy: 10 }, amount: { font: 'ExtraBold', size: 19, color: 'ink', dy: 28 },
    words: { font: 'Medium', size: 9, color: 'label', dy: 52 },
  },
  note: { breakMin: 60, pad: 10, padY: 5, font: 'Regular', size: 8.5, color: '#444444', lineGap: 4.5, fill: 'fillPanel', stroke: '#e2e8f0', strokeWidth: 0.5, after: 8 },
  footnote: { dy: -40, font: 'Regular', size: 8.5, color: 'muted', lineGap: 3.5 },
});

/** Remittance statement (A8 §8): one page, date line, salutation, subject, paragraphs, detail lists, signature with seal. */
export const REMITTANCE_FRAME = Object.freeze({
  dateDy: 14, date: { font: 'Bold', size: 9.5, color: 'ink' },
  salutationDy: 30, salutation: { font: 'Bold', size: 10, color: 'ink', after: 18 },
  subject: { font: 'Bold', size: 10.5, color: 'ink', after: 18 },
  paragraph: { fontSize: 10, lineGap: 7, color: 'body', regularFont: 'Regular', boldFont: 'Bold', after: 16, closingAfter: 30 },
  list: {
    rowH: 19, labelW: 130, indent: 18, step: 22, after: 18, separator: ':  ',
    title: { font: 'Bold', size: 10, color: 'ink' }, intro: { font: 'Regular', size: 10, color: 'body' },
    label: { font: 'Regular', size: 10, color: 'label' }, value: { font: 'SemiBold', size: 10, color: 'ink' },
  },
  signature: {
    variant: 'large', imageOptions: { trim: true, resizeWidth: 500, flattenWhite: false }, imageHeight: 46,
    offsets: { image: 22, name: 10, title: 15 }, forStyle: { font: 'Bold', size: 10 }, nameStyle: { font: 'Bold', size: 10 },
    titleStyle: { font: 'Medium', size: 9 }, seal: { dy: -4 },
  },
});

/** Expense statement (A8 §10): letterhead 8/7.5, footer 7, title, date, addressee, subject, runs paragraphs, bordered tables. */
export const EXPENSE_FRAME = Object.freeze({
  letterhead: { nameSize: 8, lineSize: 7.5 },
  footer: { size: 7 },
  title: { before: 0.4, font: 'ExtraBold', size: 16, color: 'ink', after: 0.8 },
  date: { font: 'Bold', size: 10, labelFont: 'SemiBold', labelColor: 'muted', color: 'ink', after: 30 },
  to: { font: 'Bold', size: 10.5, color: 'ink', nameFont: 'Regular', nameColor: 'body', nameDy: 4, after: 1.6 },
  subject: { font: 'Bold', size: 10.5, color: 'ink', after: 1.4 },
  salutation: { font: 'Regular', size: 10.5, color: 'body', after: 1.1 },
  para: { size: 10.5, lineGap: 6, regularFont: 'Regular', boldFont: 'Bold', color: 'body', boldColor: 'ink', after: 1.1 },
  field: { font: 'Bold', size: 10.5, color: 'ink', valueFont: 'Regular', valueColor: 'body', lineGap: 6, after: 0.35, afterWords: 1.0 },
  table: { pad: 10, minH: 28, textPad: 16, border: '#d9d9d9', borderWidth: 0.6, fill: '#f3f4f6', head: { font: 'Bold', size: 10 }, row: { size: 9.5 }, color: 'body', strong: 'ink', after: 18 },
  h2: { breakMin: 90, before: 0.2, font: 'Bold', size: 13, color: 'ink', lineGap: 1.5, after: 0.5 },
  bankBreakMin: 180,
  signOff: {
    breakMin: 260, before: 0.4, closing: { font: 'Regular', size: 10.5, color: 'body', after: 1.1 },
    forLine: { font: 'Bold', size: 10.5, color: 'ink' }, imageDy: 8, imageHeight: 44, imageAfter: 8,
    imageOptions: { trim: true, resizeHeight: 160, flattenWhite: false }, variant: 'large',
    name: { font: 'Bold', size: 11, color: 'ink' }, title: { font: 'Regular', size: 10, color: 'body', dy: 4 },
    line: { font: 'Regular', size: 10, color: 'body', boldFont: 'Bold', boldColor: 'ink', dy: 3 },
  },
});

const setFont = (ctx, s) => ctx.doc.font(s.font).fontSize(s.size).fillColor(paletteColour(ctx.palette, s.color));
const col = (ctx, c) => paletteColour(ctx.palette, c);

/**
 * Letterhead on every page added from now on (cursor at `contentTop`, default `MT + CP`); returns a live object
 * whose `ruleY` is the letterhead rule of the last page drawn.
 */
async function attachHead(ctx, { contact, letterhead = {}, contentTop } = {}) {
  const o = { ...LETTERHEAD_DEFAULTS, ...letterhead };
  const logo = await ctx.assets.logo({ resizeHeight: o.logoResizeHeight });
  const { MT, CP } = ctx.profile;
  const state = { ruleY: null };
  onPageAdded(ctx, () => {
    state.ruleY = drawLetterhead(ctx, { ...o, contact, logo }).ruleY;
    ctx.doc.y = contentTop ?? MT + (CP ?? 0);
  });
  return state;
}

/** Legacy `needsBreak(min)`: cursor within `min` of `PH - MB - CP`. */
const needs = (ctx, min) => ctx.doc.y > ctx.profile.PH - ctx.profile.MB - (ctx.profile.CP ?? 0) - min;

// ---------------------------------------------------------------- employee final settlement (A8 §6b)

/**
 * Draw the employee final settlement page.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ title: string, meta: Array<Array<{ label: string, value: string }|null>>,
 *   tables: Array<{ title: string, rows: Array<{ label: string, value: string, bold?: boolean, valBold?: boolean, bullet?: boolean }> }>,
 *   net: { label: string, note: string, amount: string }, declaration?: { title: string, text: string }|null,
 *   signRow: { labels: string[], date: string, signatoryId?: string|null, imageOptions?: object, variant?: string } }} m
 * @param {{ contact?: string, frame?: object, footer?: object }} [opts]
 */
export async function drawEmployeeSettlement(ctx, m, opts = {}) {
  const f = mergeStyle(EMPLOYEE_SETTLEMENT_FRAME, opts.frame ?? {});
  const { doc, profile } = ctx;
  const { ML, CW } = profile;
  const head = await attachHead(ctx, { contact: opts.contact });
  doc.addPage();

  setFont(ctx, f.title).text(m.title, ML, head.ruleY + f.title.dy, { align: 'center', width: CW });

  const mt = f.meta;
  const metaY = head.ruleY + mt.dy;
  const cols = [[ML + mt.labelX, ML + mt.valueX], [ML + mt.col2X, ML + mt.col2X + mt.col2ValueDx]];
  m.meta.forEach((row, r) => row.forEach((cell, c) => {
    if (!cell || c > 1) return;
    const y = metaY + mt.rowGap * r;
    setFont(ctx, mt.label).text(cell.label, cols[c][0], y, { lineBreak: false });
    setFont(ctx, mt.value).text(cell.value, cols[c][1], y, { lineBreak: false });
  }));
  let curY = metaY + mt.rowGap * m.meta.length + mt.after;

  const t = f.table;
  const descW = CW - t.valueWidth;
  const splitX = ML + descW;
  const sr = f.signRow;
  const limit = sr.lineY - sr.imageHeight - sr.imageGap - sr.clearance;
  const fit = (h) => {
    if (curY + h > limit) {
      doc.addPage();
      curY = doc.y;
    }
  };
  const border = col(ctx, t.border);

  for (const table of m.tables) {
    fit(t.headerH + t.rowH * Math.max(1, table.rows.length));
    const startY = curY;
    doc.rect(ML, startY, CW, t.headerH).fill(col(ctx, t.headerFill));
    doc.rect(ML, startY, CW, t.headerH).strokeColor(border).lineWidth(t.borderWidth).stroke();
    setFont(ctx, t.title).text(table.title, ML + t.title.dx, startY + t.title.dy, { width: CW - 2 * t.title.dx });
    let y = startY + t.headerH;
    table.rows.forEach((r, i) => {
      if (i % 2 === 1) doc.rect(ML, y, CW, t.rowH).fill(col(ctx, t.altFill));
      const bold = Boolean(r.bold);
      doc.font(bold ? 'Bold' : t.label.font).fontSize(t.label.size).fillColor(col(ctx, bold ? t.strong : t.label.color))
        .text(`${r.bullet === false ? '' : t.bullet}${r.label}`, ML + t.textDx, y + t.textDy, { width: descW - t.labelInset, lineBreak: false });
      doc.font(bold || r.valBold ? 'Bold' : t.valueFont).fontSize(t.label.size).fillColor(col(ctx, t.strong))
        .text(r.value, splitX + t.valuePad, y + t.textDy, { align: 'right', width: t.valueWidth - t.valueInset, lineBreak: false });
      doc.moveTo(ML, y + t.rowH).lineTo(ML + CW, y + t.rowH).strokeColor(border).lineWidth(t.ruleWidth).stroke();
      y += t.rowH;
    });
    doc.moveTo(ML, startY).lineTo(ML, y).strokeColor(border).lineWidth(t.borderWidth).stroke();
    doc.moveTo(ML + CW, startY).lineTo(ML + CW, y).strokeColor(border).lineWidth(t.borderWidth).stroke();
    doc.moveTo(splitX, startY + t.headerH).lineTo(splitX, y).strokeColor(border).lineWidth(t.ruleWidth).stroke();
    curY = y + t.after;
  }

  const n = f.net;
  fit(n.height);
  doc.rect(ML, curY, CW, n.height).fillOpacity(n.fillOpacity).fill(col(ctx, n.fill));
  doc.fillOpacity(1);
  doc.rect(ML, curY, CW, n.height).strokeColor(col(ctx, n.stroke)).lineWidth(n.strokeWidth).stroke();
  doc.moveTo(splitX, curY).lineTo(splitX, curY + n.height).strokeColor(border).lineWidth(t.ruleWidth).stroke();
  setFont(ctx, n.label).text(m.net.label, ML + n.label.dx, curY + n.label.dy);
  if (m.net.note) setFont(ctx, n.note).text(m.net.note, ML + n.note.dx, curY + n.note.dy);
  setFont(ctx, n.amount).text(m.net.amount, splitX + t.valuePad, curY + n.amount.dy, { align: 'right', width: t.valueWidth - t.valueInset });
  curY += n.height + n.after;

  if (m.declaration?.text) {
    const d = f.declaration;
    doc.font(d.text.font).fontSize(d.text.size);
    const h = d.textDy + doc.heightOfString(m.declaration.text, { width: CW, lineGap: d.text.lineGap });
    fit(d.gap + h);
    curY += d.gap;
    if (m.declaration.title) setFont(ctx, d.title).text(m.declaration.title, ML, curY);
    setFont(ctx, d.text).text(m.declaration.text, ML, curY + d.textDy, { width: CW, lineGap: d.text.lineGap });
  }

  // Signature row: signatory's signature above the first line, the date above the middle one.
  const [w1, w2, w3] = sr.widths;
  const xs = [ML, ML + (CW - w2) / 2, ML + CW - w3];
  [w1, w2, w3].forEach((w, i) => {
    const label = m.signRow.labels[i];
    if (label === undefined || label === null) return;
    doc.moveTo(xs[i], sr.lineY).lineTo(xs[i] + w, sr.lineY).strokeColor(col(ctx, sr.lineColor)).lineWidth(sr.lineWidth).stroke();
    setFont(ctx, sr.label).text(label, xs[i], sr.lineY + sr.label.dy, { align: 'center', width: w });
  });
  if (m.signRow.signatoryId) {
    const img = await ctx.assets.signature(m.signRow.signatoryId, { variant: m.signRow.variant ?? 'large', trim: true, flattenWhite: false, ...m.signRow.imageOptions });
    const sigW = (img.width / img.height) * sr.imageHeight;
    placeImage(ctx, img, xs[0] + (w1 - sigW) / 2, sr.lineY - sr.imageHeight - sr.imageGap, { height: sr.imageHeight });
  }
  if (m.signRow.date) setFont(ctx, sr.date).text(m.signRow.date, xs[1], sr.lineY + sr.date.dy, { align: 'center', width: w2 });

  drawFooters(ctx, opts.footer ?? {});
}

// ---------------------------------------------------------------- ticketing & settlement statement (A8 §7)

/** Shared title + two-column meta block (ticketing: every page in a post-pass; client settlement: page 1). */
function titleMeta(ctx, h, title, left, right, { lineGapText } = {}) {
  const { doc, profile } = ctx;
  const { ML, PW, MR, CW } = profile;
  setFont(ctx, h.title).text(title, ML, h.titleY, { align: 'center', width: CW });
  doc.moveTo(ML, h.ruleY).lineTo(PW - MR, h.ruleY).strokeColor(col(ctx, h.rule)).lineWidth(h.ruleWidth).stroke();
  const metaY = h.ruleY + h.metaDy;
  const colW = CW / 2 - 10;
  const gap = lineGapText !== undefined ? { lineGap: lineGapText } : {};
  let ly = metaY;
  for (const { label, value } of left) {
    setFont(ctx, h.label).text(label, ML, ly, { width: h.labelW });
    setFont(ctx, h.value).text(value, ML + h.valueDx, ly, { width: colW - h.valueDx, ...gap });
    ly += Math.max(doc.heightOfString(value, { width: colW - h.valueDx, ...gap }), h.minLine) + h.lineGap;
  }
  const rightX = ML + colW + h.colGap;
  const rLabelW = h.rightLabelW ?? h.labelW;
  const rValueDx = h.rightValueDx ?? h.valueDx;
  let ry = metaY;
  for (const { label, value } of right) {
    setFont(ctx, h.label).text(label, rightX, ry, { width: rLabelW });
    setFont(ctx, h.value).text(value, rightX + rValueDx, ry, { width: colW - rValueDx });
    ry += h.rightStep;
  }
  return Math.max(ly, ry);
}

/** Slate section bar (`text` upper-cased). */
function sectionBar(ctx, s, text) {
  const { doc, profile } = ctx;
  if (needs(ctx, s.breakMin)) doc.addPage();
  doc.moveDown(s.before);
  const y = doc.y;
  doc.rect(profile.ML, y, profile.CW, s.height).fill(col(ctx, s.fill));
  setFont(ctx, s).text(text.toUpperCase(), profile.ML + s.dx, y + s.dy, { width: profile.CW - 2 * s.dx });
  doc.y = y + s.height + s.after;
}

/**
 * Draw the ticketing & settlement statement.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ title: string, metaLeft: Array<{ label: string, value: string }>, metaRight: Array<{ label: string, value: string }>,
 *   sections: { sales: string, charges: string, settlement: string, acknowledgement: string },
 *   columns: Array<{ key: string, label: string, width?: number, align?: string }>,
 *   rows: Array<{ cells: Record<string, string>, group: number }>, totalRow: Record<string, string>,
 *   charges: null|{ title: string, lines: Array<[string, string]>, total: [string, string] },
 *   final: { label: string, amount: string },
 *   acknowledgement: null|{ text: string, fields: string[], spacing: number, breakMin: number } }} m
 *   `metaRight` values may hold `{page}` and `{pages}`, filled per page.
 * @param {{ contact?: string, frame?: object, footer?: object }} [opts]
 */
export async function drawTicketingStatement(ctx, m, opts = {}) {
  const f = mergeStyle(TICKETING_FRAME, opts.frame ?? {});
  const { doc, profile } = ctx;
  const { ML, CW, MT, CP } = profile;
  await attachHead(ctx, { contact: opts.contact, contentTop: MT + (CP ?? 0) + f.contentDy });
  doc.addPage();

  sectionBar(ctx, f.section, m.sections.sales);

  // Ticket table
  const t = f.table;
  const fixed = m.columns.reduce((s, c) => s + (c.width ?? 0), 0);
  let x = ML;
  const cols = m.columns.map((c) => {
    const w = c.width ?? CW - fixed;
    const out = { ...c, align: c.align ?? 'left', x, w };
    x += w;
    return out;
  });
  const cell = (c, text, y) => {
    const pad = c.align === 'left' ? t.pad : 0;
    doc.text(text, c.x + pad, y, { align: c.align, width: c.w - t.pad, lineBreak: false });
  };
  const startY = doc.y;
  setFont(ctx, t.head);
  cols.forEach((c) => cell(c, c.label, startY + t.headDy));
  doc.moveTo(ML, startY + t.headH).lineTo(ML + CW, startY + t.headH).strokeColor(col(ctx, t.headRule)).lineWidth(t.headRuleWidth).stroke();
  let y = startY + t.headH + t.gapAfterHead;
  for (const r of m.rows) {
    if (y + t.rowH > profile.PH - profile.MB - (CP ?? 0)) {
      doc.addPage();
      y = doc.y;
    }
    doc.rect(ML, y, CW, t.rowH).fill(col(ctx, t.fills[r.group % 2 === 0 ? 0 : 1]));
    setFont(ctx, t.row);
    cols.forEach((c) => cell(c, r.cells[c.key] ?? '', y + t.rowDy));
    doc.moveTo(ML, y + t.rowH).lineTo(ML + CW, y + t.rowH).strokeColor(col(ctx, t.rule)).lineWidth(t.ruleWidth).stroke();
    y += t.rowH;
  }
  y += t.gapBeforeTotal;
  doc.rect(ML, y, CW, t.rowH).fill(col(ctx, t.total.fill));
  setFont(ctx, t.total);
  cols.forEach((c) => cell(c, m.totalRow[c.key] ?? '', y + t.rowDy));
  doc.moveTo(ML, y + t.rowH).lineTo(ML + CW, y + t.rowH).strokeColor(col(ctx, t.totalRule)).lineWidth(t.totalRuleWidth).stroke();
  doc.y = y + t.rowH + t.after;

  if (m.charges) {
    const c = f.charges;
    if (needs(ctx, c.breakMin)) doc.addPage();
    sectionBar(ctx, f.section, m.sections.charges);
    const innerX = ML + c.barW + c.pad;
    const innerW = CW - c.barW - c.pad * 2;
    const y0 = doc.y;
    const lines = m.charges.lines.length;
    const cardH = c.pad + 22 + c.lineH * lines + 10 + 24 + c.pad - 4;
    doc.roundedRect(ML, y0, CW, cardH, c.radius).fill(col(ctx, c.fill));
    doc.rect(ML, y0, c.barW, cardH).fill(col(ctx, c.bar));
    let cy = y0 + c.pad;
    setFont(ctx, c.title).text(m.charges.title, innerX, cy, { width: innerW });
    cy += c.title.after;
    const line = (label, value, s) => {
      setFont(ctx, s).text(label, innerX, cy, { width: innerW / 2, lineBreak: false });
      doc.text(value, innerX + innerW / 2, cy, { width: innerW / 2, align: 'right', lineBreak: false });
    };
    for (const [label, value] of m.charges.lines) {
      line(label, value, c.line);
      cy += c.lineH;
    }
    cy += 2;
    doc.moveTo(innerX, cy).lineTo(innerX + innerW, cy).strokeColor(col(ctx, c.rule)).lineWidth(c.ruleWidth).stroke();
    cy += 10;
    line(m.charges.total[0], m.charges.total[1], c.total);
    doc.y = y0 + cardH + c.after;
  }

  const fb = f.final;
  if (needs(ctx, fb.breakMin)) doc.addPage();
  sectionBar(ctx, f.section, m.sections.settlement);
  const y0 = doc.y;
  doc.rect(ML, y0, CW, fb.height).fillAndStroke(col(ctx, fb.fill), col(ctx, fb.stroke));
  doc.lineWidth(fb.lineWidth); // legacy sets the width after stroking; kept for identical output
  setFont(ctx, fb.label).text(m.final.label, ML, y0 + fb.label.dy, { width: CW, align: 'center' });
  setFont(ctx, fb.amount).text(m.final.amount, ML, y0 + fb.amount.dy, { width: CW, align: 'center' });
  doc.y = y0 + fb.height + fb.after;

  if (m.acknowledgement) {
    const a = f.acknowledgement;
    if (needs(ctx, a.breakMin)) doc.addPage();
    sectionBar(ctx, f.section, m.sections.acknowledgement);
    setFont(ctx, a.text).text(m.acknowledgement.text, ML, doc.y, { width: CW, align: 'justify', lineGap: a.text.lineGap });
    if (needs(ctx, m.acknowledgement.breakMin)) doc.addPage();
    const fy0 = doc.y + a.fieldsDy;
    const colW = CW / 2 - a.colInset;
    setFont(ctx, a.field);
    m.acknowledgement.fields.forEach((label, i) => {
      const fy = fy0 + i * m.acknowledgement.spacing;
      doc.text(label, ML, fy, { width: a.labelW });
      doc.moveTo(ML + a.labelW, fy + a.lineDy).lineTo(ML + a.labelW + colW, fy + a.lineDy).strokeColor(col(ctx, a.line)).lineWidth(a.lineWidth).stroke();
    });
    doc.y = fy0 + m.acknowledgement.fields.length * m.acknowledgement.spacing;
  }

  drawFooters(ctx, opts.footer ?? {});
  // Post-pass: the title and meta block on every page (page numbers known now).
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fill = (s) => String(s).replaceAll('{page}', String(i + 1)).replaceAll('{pages}', String(count));
    titleMeta(ctx, f.head, m.title, m.metaLeft, m.metaRight.map((r) => ({ label: r.label, value: fill(r.value) })));
    doc.page.margins.bottom = saved;
  }
}

// ---------------------------------------------------------------- client final settlement (A8 §7b)

/**
 * Draw the client final settlement statement.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ title: string, metaLeft: Array<{ label: string, value: string }>, metaRight: Array<{ label: string, value: string }>,
 *   sections: Array<{ title: string, breakBefore?: boolean, columns: Array<{ label: string, width: number, align?: string }>,
 *     rows: Array<{ cells: string[], bold?: boolean[]|boolean, bg?: string|null }>, after: number }>,
 *   total: { label: string, amount: string, words: string }, note: string, footnote: string }} m
 * @param {{ contact?: string, frame?: object, footer?: object }} [opts]
 */
export async function drawClientSettlement(ctx, m, opts = {}) {
  const f = mergeStyle(CLIENT_SETTLEMENT_FRAME, opts.frame ?? {});
  const { doc, profile } = ctx;
  const { ML, CW, PH, MB } = profile;
  const CP = profile.CP ?? 0;
  await attachHead(ctx, { contact: opts.contact });
  doc.addPage();
  doc.y = titleMeta(ctx, f.head, m.title, m.metaLeft, m.metaRight, { lineGapText: f.head.lineGapText }) + f.head.after;

  const t = f.table;
  const row = (y, cells, { isHeader = false, bg = null } = {}) => {
    let maxH = 0;
    for (const c of cells) {
      doc.font(c.bold || isHeader ? 'Bold' : 'Regular').fontSize(t.size);
      const h = doc.heightOfString(c.text, { width: c.width - 2 * t.cellPad, lineGap: t.lineGap });
      if (h > maxH) maxH = h;
    }
    const rowH = maxH + t.pad * 2;
    if (y + rowH > PH - MB - CP) {
      doc.addPage();
      y = doc.y;
    }
    if (bg) doc.rect(ML, y, CW, rowH).fill(col(ctx, bg));
    let cx = ML;
    for (const c of cells) {
      doc.font(c.bold || isHeader ? 'Bold' : 'Regular').fontSize(t.size).fillColor(col(ctx, isHeader ? t.headColor : t.color));
      doc.text(c.text, cx + t.cellPad, y + t.pad, { width: c.width - 2 * t.cellPad, align: c.align ?? 'left', lineGap: t.lineGap });
      cx += c.width;
    }
    doc.moveTo(ML, y + rowH).lineTo(ML + CW, y + rowH)
      .strokeColor(col(ctx, isHeader ? t.headRule : t.rule)).lineWidth(isHeader ? t.headRuleWidth : t.ruleWidth).stroke();
    return y + rowH;
  };

  for (const s of m.sections) {
    if (s.breakBefore) doc.addPage();
    sectionBar(ctx, f.section, s.title);
    let y = doc.y;
    y = row(y, s.columns.map((c) => ({ text: c.label, width: c.width, align: c.align, bold: true })), { isHeader: true });
    s.rows.forEach((r, idx) => {
      const bold = (i) => (Array.isArray(r.bold) ? Boolean(r.bold[i]) : Boolean(r.bold));
      const bg = r.bg !== undefined ? r.bg : t.fills[idx % 2];
      y = row(y, s.columns.map((c, i) => ({ text: r.cells[i] ?? '', width: c.width, align: c.align, bold: bold(i) })), { bg });
    });
    doc.y = y + s.after;
  }

  const tb = f.total;
  if (doc.y + tb.height > PH - MB - CP) doc.addPage();
  const startY = doc.y;
  doc.rect(ML, startY, CW, tb.height).fill(col(ctx, tb.fill));
  doc.rect(ML, startY, CW, tb.height).strokeColor(col(ctx, tb.stroke)).lineWidth(tb.strokeWidth).stroke();
  setFont(ctx, tb.label).text(m.total.label, ML, startY + tb.label.dy, { align: 'center', width: CW });
  setFont(ctx, tb.amount).text(m.total.amount, ML, startY + tb.amount.dy, { align: 'center', width: CW });
  if (m.total.words) setFont(ctx, tb.words).text(m.total.words, ML, startY + tb.words.dy, { align: 'center', width: CW });
  doc.y = startY + tb.height + tb.after;

  if (m.note) {
    const n = f.note;
    if (needs(ctx, n.breakMin)) doc.addPage();
    const y = doc.y;
    doc.font(n.font).fontSize(n.size);
    const boxH = doc.heightOfString(m.note, { width: CW - 2 * n.pad, lineGap: n.lineGap }) + 2 * n.padY;
    doc.rect(ML, y, CW, boxH).fill(col(ctx, n.fill));
    doc.rect(ML, y, CW, boxH).strokeColor(col(ctx, n.stroke)).lineWidth(n.strokeWidth).stroke();
    setFont(ctx, n).text(m.note, ML + n.pad, y + n.padY, { width: CW - 2 * n.pad, align: 'justify', lineGap: n.lineGap });
    doc.y = y + boxH + n.after;
  }

  drawFooters(ctx, opts.footer ?? {});
  if (m.footnote) {
    const { start, count } = doc.bufferedPageRange();
    doc.switchToPage(start + count - 1);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fn = f.footnote;
    doc.y = PH - MB + fn.dy;
    setFont(ctx, fn).text(m.footnote, ML, doc.y, { width: CW, align: 'justify', lineGap: fn.lineGap });
    doc.page.margins.bottom = saved;
  }
}

// ---------------------------------------------------------------- remittance statement (A8 §8)

/**
 * Draw the remittance statement (one page).
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ ref: string, date: string, salutation: string, subject: string, intro: string,
 *   lists: Array<{ title?: string, intro?: string, rows: Array<[string, string]> }>, closing: string,
 *   signature: { signatoryId: string, forLine: string, seal: boolean } }} m
 * @param {{ contact?: string, frame?: object, footer?: object }} [opts]
 */
export async function drawRemittance(ctx, m, opts = {}) {
  const f = mergeStyle(REMITTANCE_FRAME, opts.frame ?? {});
  const { doc, profile } = ctx;
  const { ML, CW, MT } = profile;
  const CP = profile.CP ?? 0;
  await attachHead(ctx, { contact: opts.contact });
  doc.addPage();

  doc.y = MT + CP + f.dateDy;
  const refY = doc.y;
  setFont(ctx, f.date);
  if (m.ref) doc.text(m.ref, ML, refY, { lineBreak: false });
  doc.text(m.date, ML, refY, { align: 'right', width: CW });

  doc.y = refY + f.salutationDy;
  setFont(ctx, f.salutation).text(m.salutation, ML, doc.y);
  doc.y += f.salutation.after;
  setFont(ctx, f.subject).text(m.subject, ML, doc.y, { width: CW });
  doc.y += f.subject.after;

  const p = f.paragraph;
  const para = (text, after) => {
    renderParagraph(ctx, text, ML, CW, {
      fontSize: p.fontSize, lineGap: p.lineGap, fillColor: col(ctx, p.color), regularFont: p.regularFont, boldFont: p.boldFont,
      align: 'justify', moveDown: 0,
    });
    doc.y += after;
  };
  para(m.intro, p.after);

  const l = f.list;
  for (const list of m.lists) {
    let y = doc.y;
    if (list.title) {
      setFont(ctx, l.title).text(list.title, ML, y, { lineBreak: false });
      y += l.step;
    }
    if (list.intro) {
      setFont(ctx, l.intro).text(list.intro, ML, y, { lineBreak: false });
      y += l.step;
    }
    for (const [label, value] of list.rows) {
      setFont(ctx, l.label).text(label, ML + l.indent, y, { width: l.labelW, lineBreak: false });
      setFont(ctx, l.value).text(`${l.separator}${value}`, ML + l.indent + l.labelW, y, { width: CW - l.indent - l.labelW, lineBreak: false });
      y += l.rowH;
    }
    doc.y = y + l.after;
  }

  if (m.closing) para(m.closing, p.closingAfter);

  const s = f.signature;
  await drawSignatureBlock(ctx, {
    x: ML, y: doc.y, signatoryId: m.signature.signatoryId, forLine: m.signature.forLine, variant: s.variant,
    imageOptions: s.imageOptions, imageHeight: s.imageHeight, offsets: s.offsets, forStyle: s.forStyle, nameStyle: s.nameStyle,
    titleStyle: s.titleStyle, seal: m.signature.seal ? s.seal : null,
  });

  drawFooters(ctx, opts.footer ?? {});
}

// ---------------------------------------------------------------- expense statement (A8 §10)

/**
 * Draw the expense statement.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ title: string, ref: string, dateLabel: string, date: string, toLabel: string, recipient: string, subject: string,
 *   salutation: string, opening: string[], table: { columns: Array<{ label: string, width?: number, align?: string }>,
 *   rows: Array<{ cells: string[], total?: boolean, bold?: boolean }> }, wordsLabel: string, words: string,
 *   closingParagraphs: string[], bankTitle: string, bank: null|{ columns: Array<{ label: string, width?: number }>, rows: Array<{ cells: string[] }> },
 *   signOff: { closing: string, yoursLine: string, forLine: string, signatoryId: string, name: string, title: string,
 *     lines: Array<{ text: string, bold?: boolean }> } }} m
 * @param {{ contact?: string, frame?: object, footer?: object }} [opts]
 */
export async function drawExpenseStatement(ctx, m, opts = {}) {
  const f = mergeStyle(EXPENSE_FRAME, opts.frame ?? {});
  const { doc, profile } = ctx;
  const { ML, CW, PW, MR } = profile;
  await attachHead(ctx, { contact: opts.contact, letterhead: f.letterhead });
  doc.addPage();

  const para = (text) => {
    const runs = inlineRuns(text);
    const pa = f.para;
    doc.text('', ML, doc.y, { width: CW, continued: true, lineGap: pa.lineGap });
    runs.forEach((r, i) => {
      doc.font(r.bold ? pa.boldFont : pa.regularFont).fontSize(pa.size).fillColor(col(ctx, r.bold ? pa.boldColor : pa.color))
        .text(r.text, { continued: i < runs.length - 1, lineGap: pa.lineGap });
    });
    doc.moveDown(pa.after);
  };

  const table = (spec, { keyBold = true } = {}) => {
    const tb = f.table;
    const widths = spec.columns.map((c) => c.width ?? 0);
    widths[widths.length - 1] = CW - widths.slice(0, -1).reduce((a, b) => a + b, 0);
    const rowHeight = (cells, font, size) => {
      doc.font(font).fontSize(size);
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(String(t), { width: widths[i] - tb.pad * 2 })));
      return Math.max(tb.minH, h + tb.textPad);
    };
    const drawCells = (cells, y, h, styleFor, color) => {
      let x = ML;
      cells.forEach((t, i) => {
        const [font, size] = styleFor(i);
        doc.font(font).fontSize(size);
        const th = doc.heightOfString(String(t), { width: widths[i] - tb.pad * 2 });
        doc.fillColor(color).text(String(t), x + tb.pad, y + (h - th) / 2 + 0.5, { width: widths[i] - tb.pad * 2, align: spec.columns[i].align || 'left' });
        x += widths[i];
      });
    };
    const heights = spec.rows.map((r) => rowHeight(r.cells, r.bold || r.total ? tb.head.font : 'Regular', tb.row.size));
    const totalH = heights.reduce((a, b) => a + b, 0) + tb.minH;
    if (needs(ctx, totalH)) doc.addPage();
    const border = col(ctx, tb.border);
    const lines = (y, h) => {
      doc.rect(ML, y, CW, h).lineWidth(tb.borderWidth).strokeColor(border).stroke();
      let x = ML;
      widths.slice(0, -1).forEach((w) => {
        x += w;
        doc.moveTo(x, y).lineTo(x, y + h).lineWidth(tb.borderWidth).strokeColor(border).stroke();
      });
    };
    let y = doc.y;
    doc.rect(ML, y, CW, tb.minH).fill(col(ctx, tb.fill));
    drawCells(spec.columns.map((c) => c.label), y, tb.minH, () => [tb.head.font, tb.head.size], col(ctx, tb.strong));
    lines(y, tb.minH);
    y += tb.minH;
    spec.rows.forEach((r, idx) => {
      const h = heights[idx];
      if (r.total) {
        doc.rect(ML, y, CW, h).fill(col(ctx, tb.fill));
        drawCells(r.cells, y, h, () => [tb.head.font, tb.head.size], col(ctx, tb.strong));
      } else {
        drawCells(r.cells, y, h, (i) => [r.bold || (keyBold && i === 0) ? tb.head.font : 'Regular', tb.row.size], col(ctx, r.bold ? tb.strong : tb.color));
      }
      lines(y, h);
      y += h;
    });
    doc.x = ML;
    doc.y = y + tb.after;
  };

  const ti = f.title;
  doc.moveDown(ti.before);
  setFont(ctx, ti).text(m.title, ML, doc.y, { align: 'center', width: CW });
  doc.moveDown(ti.after);

  const d = f.date;
  doc.font(d.font).fontSize(d.size);
  const valueW = doc.widthOfString(m.date);
  doc.font(d.labelFont);
  const labelW = doc.widthOfString(m.dateLabel);
  const dateY = doc.y;
  if (m.ref) doc.font(d.font).fillColor(col(ctx, d.color)).text(m.ref, ML, dateY, { lineBreak: false }).font(d.labelFont);
  doc.fillColor(col(ctx, d.labelColor)).text(m.dateLabel, PW - MR - valueW - labelW, dateY, { lineBreak: false });
  doc.font(d.font).fillColor(col(ctx, d.color)).text(m.date, PW - MR - valueW, dateY, { lineBreak: false });
  doc.x = ML;
  doc.y = dateY + d.after;

  const to = f.to;
  setFont(ctx, to).text(m.toLabel, ML, doc.y);
  doc.font(to.nameFont).fillColor(col(ctx, to.nameColor)).text(m.recipient, ML, doc.y + to.nameDy);
  doc.moveDown(to.after);

  setFont(ctx, f.subject).text(m.subject, ML, doc.y, { width: CW });
  doc.moveDown(f.subject.after);
  setFont(ctx, f.salutation).text(m.salutation, ML, doc.y);
  doc.moveDown(f.salutation.after);

  for (const text of m.opening) para(text);
  table(m.table);

  const fd = f.field;
  setFont(ctx, fd).text(`${m.wordsLabel}: `, ML, doc.y, { continued: true, width: CW, lineGap: fd.lineGap })
    .font(fd.valueFont).fillColor(col(ctx, fd.valueColor)).text(m.words);
  doc.moveDown(fd.after);
  doc.moveDown(fd.afterWords);

  for (const text of m.closingParagraphs) para(text);

  if (m.bank) {
    if (needs(ctx, f.bankBreakMin)) doc.addPage();
    const h2 = f.h2;
    if (needs(ctx, h2.breakMin)) doc.addPage();
    doc.moveDown(h2.before);
    setFont(ctx, h2).text(m.bankTitle, ML, doc.y, { width: CW, lineGap: h2.lineGap });
    doc.moveDown(h2.after);
    table(m.bank);
  }

  const so = f.signOff;
  const s = m.signOff;
  if (needs(ctx, so.breakMin)) doc.addPage();
  doc.moveDown(so.before);
  if (s.closing) para(s.closing);
  setFont(ctx, so.closing).text(s.yoursLine, ML, doc.y);
  doc.moveDown(so.closing.after);
  setFont(ctx, so.forLine).text(s.forLine, ML, doc.y);
  const img = await ctx.assets.signature(s.signatoryId, { variant: so.variant, ...so.imageOptions });
  placeImage(ctx, img, ML, doc.y + so.imageDy, { height: so.imageHeight });
  doc.y += so.imageDy + so.imageHeight + so.imageAfter;
  setFont(ctx, so.name).text(s.name, ML, doc.y);
  if (s.title) setFont(ctx, so.title).text(s.title, ML, doc.y + so.title.dy);
  for (const line of s.lines) {
    doc.font(line.bold ? so.line.boldFont : so.line.font).fontSize(so.line.size)
      .fillColor(col(ctx, line.bold ? so.line.boldColor : so.line.color)).text(line.text, ML, doc.y + so.line.dy);
  }

  drawFooters(ctx, { ...f.footer, ...opts.footer });
}
