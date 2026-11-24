// Proposals and pricing reports, drawn as the legacy gen-2 proposal scripts and the pricing report scripts
// (docs/DISCOVERY.md A8 §13-14): letterhead on every page, a cover page, a contents page whose page numbers are written
// in a post-pass, then the sections (h1 / h2 / h3, justified `**bold**` paragraphs or plain paragraphs, bullets,
// dividers that are skipped near the page bottom, auto-height tables whose last bold row is a black bar and the bold
// row above it grey, or the reports' fixed 24 pt tables with black total rows, fee and price cards, the two-column
// sign-off) and the brand footer. Every size, offset and colour is in PROPOSAL_FRAME / REPORT_FRAME, which a
// template's `params.frame` deep-merges over (colours are palette keys or hex values). The model comes from
// src/render/proposalTemplate.js; nothing here prints a literal string of its own.
import { mergeStyle, paletteColour } from '../blocks.js';
import { attachLetterhead } from './letterhead.js';
import { drawFooters } from './footer.js';
import { needsBreak, renderParagraph } from './text.js';

/** Gen-2 proposal layout (legacy gen-2 proposal scripts). */
export const PROPOSAL_FRAME = Object.freeze({
  text: 'rich',
  heading: {
    1: { font: 'ExtraBold', size: 18, color: 'ink', lineGap: 2, before: 0.3, after: 0.5, breakMin: 100 },
    2: { font: 'Bold', size: 13, color: 'ink', lineGap: 1.5, before: 0.2, after: 0.5, breakMin: 70 },
    3: { font: 'SemiBold', size: 12, color: 'ink', lineGap: 1.5, before: 0.2, after: 0.4, breakMin: 55 },
  },
  paragraph: {
    font: 'Regular', boldFont: 'Bold', size: 11.5, lineGap: 2.5, color: 'body', boldColor: 'ink', align: 'justify', moveDown: 0.65,
  },
  bullets: {
    bullet: '•', font: 'Regular', size: 11.5, color: 'body', lineGap: 1.5, indent: 14, markerWidth: 10, breakMin: 22,
    itemMoveDown: 0.32, moveDown: 0.45,
  },
  divider: { breakMin: 110, before: 0.6, after: 0.6, color: 'rule', lineWidth: 0.4 },
  keyValue: {
    labelFont: 'SemiBold', valueFont: 'Regular', size: 11, labelColor: '#555', valueColor: 'ink', labelWidth: 130,
    valueX: 135, lineGap: 1, moveDown: 0.35, breakMin: 16,
  },
  table: {
    mode: 'auto',
    // auto (proposals): cell padding, font size, header SemiBold white on ink, rows Regular / bold rows Bold, the last
    // bold row a black bar and the bold row directly above it grey; `border` (older variant: { color: '#d0d0d0',
    // width: 0.35 }) strokes every row and column.
    padX: 8, padY: 6, size: 9.5, extraHeight: 2, breakMin: 40, after: 0.7, border: null,
    header: { font: 'SemiBold', fill: 'ink', color: 'white' },
    row: { font: 'Regular', boldFont: 'Bold', color: 'body', boldColor: 'ink', fills: ['#f9f9f9', '#ffffff'] },
    last: { fill: 'ink', color: 'white' },
    previous: { fill: '#d9d9d9' },
    // fixed (pricing reports): 24 pt rows, text at +10 / +6, header Bold 10 white on ink, total rows black.
    fixed: {
      rowHeight: 24, padX: 10, textDy: 6, after: 10,
      header: { font: 'Bold', size: 10, fill: 'ink', color: 'white' },
      row: { font: 'Regular', boldFont: 'Bold', size: 9.5, color: 'body', boldColor: 'ink', fills: ['#f9f9f9', '#ffffff'] },
      total: { font: 'Bold', size: 10, fill: 'ink', color: 'white' },
    },
  },
  feeCard: {
    breakMin: 95, dy: 4, height: 84, radius: 4, shadow: { dx: 2, dy: 2, fill: '#e0e0e0' }, fill: 'ink', after: 14,
    label: { font: 'SemiBold', size: 8.5, color: 'faint', x: 18, dy: 16, width: 100 },
    value: { font: 'ExtraBold', size: 36, color: 'white', x: 18, dy: 28, width: 100 },
    right: { x: 120, rightPad: 18 },
    title: { font: 'Bold', size: 11.5, color: 'white', dy: 16 },
    text: { font: 'Regular', size: 9.5, color: '#cccccc', dy: 34, lineGap: 1.5 },
  },
  priceCard: {
    breakMin: 100, dy: 4, height: 108, radius: 4, shadow: { dx: 2, dy: 2, fill: '#e0e0e0' }, fill: 'ink', after: 14,
    label: { font: 'SemiBold', size: 8.5, color: 'faint', x: 18, dy: 16, width: 170 },
    amount: { font: 'ExtraBold', size: 32, color: 'white', x: 18, dy: 30, width: 170 },
    taxLabel: { font: 'Regular', size: 8, color: '#aaaaaa', x: 18, dy: 72, width: 170 },
    right: { x: 195, rightPad: 18 },
    title: { font: 'Bold', size: 11.5, color: 'white', dy: 16 },
    text: { font: 'Regular', size: 9.5, color: '#cccccc', dy: 34, lineGap: 1.5 },
    words: { font: 'SemiBold', size: 9.5, color: 'white', dy: 84 },
  },
  signOff: {
    breakMin: 110, gap: 20, rowHeight: 20, ruleDy: 14, dataDy: 22, after: 8, dividerExtra: 4,
    heading: { font: 'SemiBold', size: 9.5, color: 'subtle' },
    rule: { color: 'rule', width: 0.4 },
    label: { font: 'SemiBold', size: 11, color: '#555', width: 105 },
    value: { font: 'Regular', size: 11, color: 'ink', dx: 108 },
  },
  contents: {
    numberWidth: 20, textX: 22, rightPad: 25, after: 0.55, subAfter: 0.35, ruleDy: 3,
    entry: { font: 'SemiBold', size: 11.5, color: 'ink', lineGap: 1 },
    sub: { font: 'Regular', size: 11, color: '#555', lineGap: 2 },
    rule: { color: 'ruleFaint', width: 0.4 },
    page: { font: 'Regular', size: 11.5, subSize: 11, color: '#aaa' },
  },
  cover: {
    style: 'details',
    // details (gen 2): title block centred above a divider; "Proposal Details" rows below it.
    details: {
      rowHeight: 22, headerGap: 26, bottomGap: 45, dividerGap: 22, titleBlockH: 110, labelWidth: 150, rowsDy: 8,
      title: { font: 'SemiBold', size: 24, color: 'ink', lineGap: 8 },
      subtitle: { font: 'Bold', size: 16, color: 'ink', lineGap: 3, dy: 10 },
      description: { font: 'Regular', size: 11.5, color: 'label', lineGap: 3, dy: 6, inset: 40 },
      meta: { font: 'Regular', size: 10.5, color: 'faint', dy: 6 },
      divider: { color: 'rule', width: 0.4 },
      heading: { font: 'Bold', size: 13, color: 'ink' },
      label: { font: 'SemiBold', size: 11, color: 'label', suffix: ':' },
      value: { font: 'Regular', size: 11, color: 'ink' },
    },
    // stacked (older gen 2): fixed divider y, "Submitted To / By" lines, upper-case labels over values.
    stacked: {
      dividerY: 560, titleBlockH: 150, rowsDy: 20, rowAfter: 0.55,
      title: { font: 'SemiBold', size: 24, color: 'ink', lineGap: 8 },
      subtitle: { font: 'Bold', size: 16, color: 'ink', dy: 10 },
      partyLabel: { font: 'Regular', size: 12, color: '#777', dy: 28, nextDy: 16 },
      party: { font: 'Bold', size: 12, color: 'ink', dy: 4 },
      divider: { color: 'rule', width: 0.4 },
      label: { font: 'SemiBold', size: 10, color: 'subtle', lineGap: 1 },
      value: { font: 'Regular', size: 11.5, color: 'ink', dy: 2, lineGap: 1.5 },
    },
    // report: everything centred and vertically centred by the legacy height estimate.
    report: {
      // Legacy height estimate: font size × factor per line.
      estimate: { factor: 1.3, title: 24, subtitle: 13, preparedFor: 12, client: 12, detailsHeader: 12, row: 11 },
      title: { font: 'SemiBold', size: 24, color: 'ink', lineGap: 8 },
      subtitle: { font: 'Regular', size: 14, color: '#777', dy: 20 },
      forLabel: { font: 'Regular', size: 12, color: '#777', dy: 12 },
      forValue: { font: 'Bold', size: 12, color: 'ink', dy: 4 },
      byLabel: { font: 'Regular', size: 11, color: '#777', dy: 30 },
      byValue: { font: 'Bold', size: 11, color: 'ink', dy: 4 },
      divider: { dy: 28, after: 18, color: 'rule', width: 0.4 },
      heading: { font: 'Bold', size: 12, color: 'ink', after: 0.6 },
      row: { font: 'Regular', size: 11, color: 'body', after: 0.35 },
    },
  },
});

/** Pricing report layout (legacy pricing report scripts): plain paragraphs and bullets, fixed tables, report cover. */
export const REPORT_FRAME = Object.freeze(mergeStyle(PROPOSAL_FRAME, {
  text: 'plain',
  table: { mode: 'fixed' },
  cover: { style: 'report' },
}));

const col = (ctx, c) => paletteColour(ctx.palette, c);
const setFont = (ctx, s, size = s.size) => ctx.doc.font(s.font).fontSize(size).fillColor(col(ctx, s.color));
const stripBold = (t) => String(t).replace(/\*\*/g, '');

function heading(ctx, f, level, text, { key, style, pages } = {}) {
  const { doc, profile } = ctx;
  const h = mergeStyle(f.heading[level], style ?? {});
  if (h.breakMin !== null && h.breakMin !== undefined && needsBreak(ctx, h.breakMin)) doc.addPage();
  if (key) pages[key] = ctx.pageNumber;
  doc.moveDown(h.before);
  setFont(ctx, h).text(text, profile.ML, doc.y, { width: profile.CW, lineGap: h.lineGap ?? 0, ...(h.align ? { align: h.align } : {}) });
  doc.moveDown(h.after);
}

function paragraph(ctx, f, text, style, x = ctx.profile.ML, width = ctx.profile.CW) {
  const p = mergeStyle(f.paragraph, style ?? {});
  if (f.text === 'plain') {
    setFont(ctx, p).text(stripBold(text), x, ctx.doc.y, { width, align: p.align, lineGap: p.lineGap });
    ctx.doc.moveDown(p.moveDown);
    return;
  }
  renderParagraph(ctx, String(text), x, width, {
    fontSize: p.size, lineGap: p.lineGap, fillColor: col(ctx, p.color), boldColor: col(ctx, p.boldColor),
    regularFont: p.font, boldFont: p.boldFont, align: p.align, moveDown: p.moveDown,
  });
}

function list(ctx, f, items, numbered, style) {
  const { doc, profile } = ctx;
  const b = mergeStyle(f.bullets, style ?? {});
  items.forEach((item, i) => {
    if (needsBreak(ctx, b.breakMin)) doc.addPage();
    const y = doc.y;
    const marker = numbered ? `${i + 1}.` : b.bullet;
    if (f.text === 'plain') {
      setFont(ctx, b).text(marker, profile.ML, y, { width: b.markerWidth, lineGap: b.lineGap })
        .text(stripBold(item), profile.ML + b.indent, y, { width: profile.CW - b.indent, lineGap: b.lineGap });
      doc.moveDown(b.itemMoveDown);
      return;
    }
    setFont(ctx, b).text(marker, profile.ML, y, { lineBreak: false });
    doc.y = y;
    paragraph(ctx, f, String(item), { size: b.size, lineGap: b.lineGap, align: 'left', moveDown: b.itemMoveDown, color: b.color },
      profile.ML + b.indent, profile.CW - b.indent);
  });
  doc.moveDown(b.moveDown);
}

function divider(ctx, f) {
  const { doc, profile } = ctx;
  const d = f.divider;
  if (needsBreak(ctx, d.breakMin)) return;
  doc.moveDown(d.before);
  doc.moveTo(profile.ML, doc.y).lineTo(profile.PW - profile.MR, doc.y).strokeColor(col(ctx, d.color)).lineWidth(d.lineWidth).stroke();
  doc.moveDown(d.after);
}

function keyValue(ctx, f, rows, style) {
  const { doc, profile } = ctx;
  const k = mergeStyle(f.keyValue, style ?? {});
  for (const [label, value] of rows) {
    if (needsBreak(ctx, k.breakMin)) doc.addPage();
    const y = doc.y;
    doc.font(k.labelFont).fontSize(k.size).fillColor(col(ctx, k.labelColor))
      .text(String(label), profile.ML, y, { width: k.labelWidth, lineGap: k.lineGap });
    doc.font(k.valueFont).fontSize(k.size).fillColor(col(ctx, k.valueColor))
      .text(String(value ?? ''), profile.ML + k.valueX, y, { width: profile.CW - k.valueX, lineGap: k.lineGap });
    doc.moveDown(k.moveDown);
  }
}

/** Column widths: given widths, the rest of `total` shared by the columns without one. */
function widthsOf(columns, total) {
  const fixed = columns.reduce((s, c) => s + (c.width ?? 0), 0);
  const flex = columns.filter((c) => c.width == null).length;
  return columns.map((c) => c.width ?? (total - fixed) / flex);
}

/**
 * Table of the proposal model: `{ columns: [{ label, width?, align }], rows: string[][], bold: number[], total: number[] }`
 * (`rows` include the total rows at the indices in `total`; `bold` lists the bold rows, totals included).
 */
function table(ctx, f, t, style) {
  if ((f.table.mode ?? 'auto') === 'fixed') return fixedTable(ctx, f, t, style);
  const { doc, profile } = ctx;
  const s = mergeStyle(f.table, style ?? {});
  const widths = widthsOf(t.columns, profile.CW);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const aligns = t.columns.map((c) => c.align ?? 'left');
  const bold = [...new Set(t.bold)].sort((a, b) => a - b);
  const lastBold = bold[bold.length - 1];
  const prevBold = bold[bold.length - 2];

  const rowHeight = (cells, font) => {
    let maxH = 0;
    cells.forEach((cell, i) => {
      doc.font(font).fontSize(s.size);
      const h = doc.heightOfString(String(cell), { width: widths[i] - s.padX * 2 });
      if (h > maxH) maxH = h;
    });
    return maxH + s.padY * 2;
  };
  const render = (cells, y, h, bg, font, color) => {
    doc.rect(profile.ML, y, totalW, h).fill(col(ctx, bg));
    if (s.border) doc.rect(profile.ML, y, totalW, h).strokeColor(col(ctx, s.border.color)).lineWidth(s.border.width).stroke();
    let x = profile.ML;
    cells.forEach((cell, i) => {
      if (s.border && i > 0) {
        doc.moveTo(x, y).lineTo(x, y + h).strokeColor(col(ctx, s.border.color)).lineWidth(s.border.width).stroke();
      }
      doc.font(font).fontSize(s.size).fillColor(col(ctx, color))
        .text(String(cell), x + s.padX, y + s.padY, { width: widths[i] - s.padX * 2, align: aligns[i], lineBreak: true });
      x += widths[i];
    });
    doc.y = y + h;
  };

  const labels = t.columns.map((c) => c.label);
  const hH = rowHeight(labels, s.header.font) + s.extraHeight;
  if (needsBreak(ctx, hH + s.breakMin)) doc.addPage();
  render(labels, doc.y, hH, s.header.fill, s.header.font, s.header.color);
  t.rows.forEach((cells, idx) => {
    const isBold = bold.includes(idx);
    const font = isBold ? s.row.boldFont : s.row.font;
    const rH = rowHeight(cells, font) + s.extraHeight;
    if (needsBreak(ctx, rH)) doc.addPage();
    const fills = s.row.fills;
    let bg = fills[idx % fills.length];
    let color = isBold ? s.row.boldColor : s.row.color;
    if (idx === lastBold) {
      bg = s.last.fill;
      color = s.last.color;
    } else if (idx === prevBold && prevBold === lastBold - 1) {
      bg = s.previous.fill;
    }
    render(cells, doc.y, rH, bg, font, color);
  });
  doc.moveDown(s.after);
}

function fixedTable(ctx, f, t, style) {
  const { doc, profile } = ctx;
  const s = mergeStyle(f.table.fixed, style ?? {});
  const rowH = s.rowHeight;
  if (needsBreak(ctx, rowH * (t.rows.length + 1))) doc.addPage();
  let y = doc.y;
  const widths = widthsOf(t.columns, profile.CW);
  const cellsAt = (cells, rowY, st, color) => {
    let x = profile.ML;
    cells.forEach((cell, i) => {
      doc.font(st.font).fontSize(st.size).fillColor(col(ctx, color))
        .text(String(cell), x + s.padX, rowY + s.textDy, { width: widths[i] - s.padX * 2, align: t.columns[i].align ?? 'left', lineBreak: false });
      x += widths[i];
    });
  };
  doc.rect(profile.ML, y, profile.CW, rowH).fill(col(ctx, s.header.fill));
  cellsAt(t.columns.map((c) => c.label), y, s.header, s.header.color);
  y += rowH;
  t.rows.forEach((cells, idx) => {
    if (t.total.includes(idx)) {
      doc.rect(profile.ML, y, profile.CW, rowH).fill(col(ctx, s.total.fill));
      cellsAt(cells, y, s.total, s.total.color);
    } else {
      doc.rect(profile.ML, y, profile.CW, rowH).fill(col(ctx, s.row.fills[idx % s.row.fills.length]));
      const isBold = t.bold.includes(idx);
      cellsAt(cells, y, { font: isBold ? s.row.boldFont : s.row.font, size: s.row.size }, isBold ? s.row.boldColor : s.row.color);
    }
    y += rowH;
  });
  doc.y = y + s.after;
}

function card(ctx, c, boxY) {
  const { doc, profile } = ctx;
  doc.roundedRect(profile.ML + c.shadow.dx, boxY + c.shadow.dy, profile.CW, c.height, c.radius).fill(col(ctx, c.shadow.fill));
  doc.roundedRect(profile.ML, boxY, profile.CW, c.height, c.radius).fill(col(ctx, c.fill));
}

/** Fee card: label and a large value at the left, title and text at the right (`{ label, value, title, text }`). */
function feeCard(ctx, f, d) {
  const { doc, profile } = ctx;
  const c = f.feeCard;
  if (needsBreak(ctx, c.breakMin)) doc.addPage();
  const x = profile.ML;
  const boxY = doc.y + c.dy;
  card(ctx, c, boxY);
  setFont(ctx, c.label).text(d.label, x + c.label.x, boxY + c.label.dy, { width: c.label.width });
  setFont(ctx, c.value).text(d.value, x + c.value.x, boxY + c.value.dy, { width: c.value.width });
  const rx = x + c.right.x;
  const rw = profile.CW - c.right.x - c.right.rightPad;
  setFont(ctx, c.title).text(d.title, rx, boxY + c.title.dy, { width: rw });
  setFont(ctx, c.text).text(d.text, rx, boxY + c.text.dy, { width: rw, lineGap: c.text.lineGap });
  doc.y = boxY + c.height + c.after;
}

/** Price card: label, amount and tax label at the left; title, text and the amount in words at the right. */
function priceCard(ctx, f, d) {
  const { doc, profile } = ctx;
  const c = f.priceCard;
  if (needsBreak(ctx, c.breakMin)) doc.addPage();
  const x = profile.ML;
  const boxY = doc.y + c.dy;
  card(ctx, c, boxY);
  setFont(ctx, c.label).text(d.label, x + c.label.x, boxY + c.label.dy, { width: c.label.width });
  setFont(ctx, c.amount).text(d.amount, x + c.amount.x, boxY + c.amount.dy, { width: c.amount.width, lineBreak: false });
  if (d.taxLabel) setFont(ctx, c.taxLabel).text(d.taxLabel, x + c.taxLabel.x, boxY + c.taxLabel.dy, { width: c.taxLabel.width });
  const rx = x + c.right.x;
  const rw = profile.CW - c.right.x - c.right.rightPad;
  setFont(ctx, c.title).text(d.title, rx, boxY + c.title.dy, { width: rw });
  setFont(ctx, c.text).text(d.text, rx, boxY + c.text.dy, { width: rw, lineGap: c.text.lineGap });
  if (d.words) setFont(ctx, c.words).text(d.words, rx, boxY + c.words.dy, { width: rw });
  doc.y = boxY + c.height + c.after;
}

/** Sign-off: one or two columns `{ heading, rows: [[label, value]] }` with a vertical rule between two. */
function signOff(ctx, f, columns) {
  const { doc, profile } = ctx;
  const s = f.signOff;
  const colW = profile.CW / 2 - s.gap / 2;
  const xs = [profile.ML, profile.ML + colW + s.gap];
  if (needsBreak(ctx, s.breakMin)) doc.addPage();
  const labelsY = doc.y;
  columns.forEach((c, i) => setFont(ctx, s.heading).text(c.heading, xs[i], labelsY, { width: colW }));
  columns.forEach((c, i) => {
    doc.moveTo(xs[i], labelsY + s.ruleDy).lineTo(xs[i] + colW, labelsY + s.ruleDy)
      .strokeColor(col(ctx, s.rule.color)).lineWidth(s.rule.width).stroke();
  });
  const dataY = labelsY + s.dataDy;
  const n = Math.max(...columns.map((c) => c.rows.length));
  for (let r = 0; r < n; r++) {
    columns.forEach((c, i) => {
      const row = c.rows[r];
      if (!row) return;
      const y = dataY + s.rowHeight * r;
      setFont(ctx, s.label).text(row[0], xs[i], y, { width: s.label.width, lineBreak: false });
      setFont(ctx, s.value).text(row[1], xs[i] + s.value.dx, y, { width: colW - s.value.dx, lineBreak: false });
    });
  }
  if (columns.length > 1) {
    const bottom = dataY + s.rowHeight * n + s.dividerExtra;
    doc.moveTo(xs[1] - s.gap / 2, labelsY).lineTo(xs[1] - s.gap / 2, bottom)
      .strokeColor(col(ctx, s.rule.color)).lineWidth(s.rule.width).stroke();
    doc.y = bottom + s.after;
  } else {
    doc.y = dataY + s.rowHeight * n + s.after;
  }
}

/**
 * Draw one model block (`heading`, `paragraph`, `bullets`, `numbered`, `table`, `keyValue`, `divider`, `pageBreak`
 * (`minSpace`: only when fewer points remain), `spacer`, `custom` `feeCard` / `priceCard` / `signOff`).
 */
function drawBlock(ctx, f, b, pages) {
  const { doc } = ctx;
  switch (b.type) {
    case 'heading': return heading(ctx, f, b.level, b.text, { style: b.style, pages });
    case 'paragraph': return paragraph(ctx, f, b.text, { ...(b.align ? { align: b.align } : {}), ...b.style });
    case 'bullets': return list(ctx, f, b.items, false, b.style);
    case 'numbered': return list(ctx, f, b.items, true, b.style);
    case 'table': return table(ctx, f, b.model, b.style);
    case 'keyValue': return keyValue(ctx, f, b.rows, b.style);
    case 'divider': return divider(ctx, f);
    case 'pageBreak':
      if (b.minSpace === undefined || needsBreak(ctx, b.minSpace)) doc.addPage();
      return undefined;
    case 'spacer':
      if (b.lines !== undefined) doc.moveDown(b.lines);
      else if (needsBreak(ctx, b.size)) doc.addPage();
      else doc.y += b.size;
      return undefined;
    case 'custom':
      if (b.name === 'feeCard') return feeCard(ctx, f, b.data);
      if (b.name === 'priceCard') return priceCard(ctx, f, b.data);
      if (b.name === 'signOff') return signOff(ctx, f, b.data.columns);
      throw new Error(`proposal frame: no drawing for custom block "${b.name}"`);
    default:
      throw new Error(`proposal frame: unsupported block type "${b.type}"`);
  }
}

function detailsCover(ctx, f, c) {
  const { doc, profile } = ctx;
  const { ML, MT, MB, PH, PW, MR, CW } = profile;
  const s = f.cover.details;
  const detBlockH = s.headerGap + c.details.length * s.rowHeight;
  const divY = PH - MB - s.bottomGap - detBlockH - s.dividerGap;
  const titleY = MT + (divY - MT - s.titleBlockH) / 2;
  setFont(ctx, s.title).text(c.title, ML, titleY, { align: 'center', width: CW, lineGap: s.title.lineGap });
  if (c.subtitle) setFont(ctx, s.subtitle).text(c.subtitle, ML, doc.y + s.subtitle.dy, { align: 'center', width: CW, lineGap: s.subtitle.lineGap });
  if (c.description) {
    setFont(ctx, s.description).text(c.description, ML + s.description.inset, doc.y + s.description.dy,
      { align: 'center', width: CW - 2 * s.description.inset, lineGap: s.description.lineGap });
  }
  if (c.meta) setFont(ctx, s.meta).text(c.meta, ML, doc.y + s.meta.dy, { align: 'center', width: CW });
  doc.moveTo(ML, divY).lineTo(PW - MR, divY).strokeColor(col(ctx, s.divider.color)).lineWidth(s.divider.width).stroke();
  doc.y = divY + s.dividerGap;
  setFont(ctx, s.heading).text(c.detailsTitle, ML, doc.y, { width: CW });
  let y = doc.y + s.rowsDy;
  for (const { label, value } of c.details) {
    setFont(ctx, s.label).text(label ? `${label}${s.label.suffix}` : '', ML, y, { width: s.labelWidth, lineBreak: false });
    setFont(ctx, s.value).text(value, ML + s.labelWidth, y, { width: CW - s.labelWidth, lineBreak: false });
    y += s.rowHeight;
  }
}

function stackedCover(ctx, f, c) {
  const { doc, profile } = ctx;
  const { ML, MT, PW, MR, CW } = profile;
  const s = f.cover.stacked;
  const divY = s.dividerY;
  const titleY = MT + (divY - MT - s.titleBlockH) / 2;
  setFont(ctx, s.title).text(c.title, ML, titleY, { align: 'center', width: CW, lineGap: s.title.lineGap });
  if (c.subtitle) setFont(ctx, s.subtitle).text(c.subtitle, ML, doc.y + s.subtitle.dy, { align: 'center', width: CW });
  c.parties.forEach((p, i) => {
    setFont(ctx, s.partyLabel).text(p.label, ML, doc.y + (i === 0 ? s.partyLabel.dy : s.partyLabel.nextDy), { align: 'center', width: CW });
    setFont(ctx, s.party).text(p.value, ML, doc.y + s.party.dy, { align: 'center', width: CW });
  });
  doc.moveTo(ML, divY).lineTo(PW - MR, divY).strokeColor(col(ctx, s.divider.color)).lineWidth(s.divider.width).stroke();
  doc.y = divY + s.rowsDy;
  for (const { label, value } of c.details) {
    const y = doc.y;
    setFont(ctx, s.label).text(String(label).toUpperCase(), ML, y, { align: 'left', width: CW, lineGap: s.label.lineGap });
    setFont(ctx, s.value).text(value, ML, doc.y + s.value.dy, { align: 'left', width: CW, lineGap: s.value.lineGap });
    doc.moveDown(s.rowAfter);
  }
}

function reportCover(ctx, f, c) {
  const { doc, profile } = ctx;
  const { ML, MT, MB, PH, PW, MR, CW } = profile;
  const s = f.cover.report;
  const e = Object.fromEntries(Object.entries(s.estimate).filter(([k]) => k !== 'factor').map(([k, v]) => [k, v * s.estimate.factor]));
  const n = c.details.length;
  const contentH = PH - MT - MB;
  // The legacy estimate (sizes × 1.3), summed in the legacy order.
  const totalCoverH = e.title + s.subtitle.dy + e.subtitle + 36 + e.preparedFor + s.forValue.dy + e.client + s.divider.dy
    + s.divider.after + e.detailsHeader + (s.heading.after * e.detailsHeader) + (n * e.row) + ((n - 1) * s.row.after * e.row);
  doc.y = MT + (contentH - totalCoverH) / 2;
  setFont(ctx, s.title).text(c.title, ML, doc.y, { align: 'center', width: CW, lineGap: s.title.lineGap });
  if (c.subtitle) setFont(ctx, s.subtitle).text(c.subtitle, ML, doc.y + s.subtitle.dy, { align: 'center', width: CW });
  if (c.preparedFor) {
    setFont(ctx, s.forLabel).text(c.preparedForLabel, ML, doc.y + s.forLabel.dy, { align: 'center', width: CW });
    setFont(ctx, s.forValue).text(c.preparedFor, ML, doc.y + s.forValue.dy, { align: 'center', width: CW });
  }
  setFont(ctx, s.byLabel).text(c.preparedByLabel, ML, doc.y + s.byLabel.dy, { align: 'center', width: CW });
  setFont(ctx, s.byValue).text(c.preparedBy, ML, doc.y + s.byValue.dy, { align: 'center', width: CW });
  const divY = doc.y + s.divider.dy;
  doc.moveTo(ML, divY).lineTo(PW - MR, divY).strokeColor(col(ctx, s.divider.color)).lineWidth(s.divider.width).stroke();
  doc.y = divY + s.divider.after;
  setFont(ctx, s.heading).text(c.detailsTitle, ML, doc.y, { align: 'center', width: CW });
  doc.moveDown(s.heading.after);
  setFont(ctx, s.row);
  c.details.forEach((row, i) => {
    if (i > 0) doc.moveDown(s.row.after);
    doc.text(typeof row === 'string' ? row : `${row.label}${row.value}`, ML, doc.y, { align: 'center', width: CW });
  });
}

function contentsPage(ctx, f, contents, pages, entriesOut) {
  const { doc, profile } = ctx;
  const { ML, PW, MR, CW } = profile;
  const s = f.contents;
  doc.addPage();
  heading(ctx, f, 1, contents.title, { pages });
  for (const e of contents.entries) {
    const y = doc.y;
    entriesOut.push({ y, key: e.key, sub: e.sub, page: ctx.pageNumber });
    if (e.sub) {
      setFont(ctx, s.sub).text(e.text, ML + s.textX, y, { width: CW - s.textX - s.rightPad, lineGap: s.sub.lineGap });
    } else {
      setFont(ctx, s.entry).text(e.num, ML, y, { width: s.numberWidth, lineGap: s.entry.lineGap })
        .text(e.text, ML + s.textX, y, { width: CW - s.textX - s.rightPad, lineGap: s.entry.lineGap });
      doc.moveTo(ML, doc.y + s.ruleDy).lineTo(PW - MR, doc.y + s.ruleDy).strokeColor(col(ctx, s.rule.color)).lineWidth(s.rule.width).stroke();
    }
    doc.moveDown(e.sub ? s.subAfter : s.after);
  }
}

/**
 * Draw a proposal or pricing report (renderPdf contract).
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ cover: object, contents: { title: string, entries: object[] }|null, sections: object[] }} model
 *   see proposalModel in src/render/proposalTemplate.js
 * @param {{ frame?: object, contact?: string, footer?: object }} [opts] `frame` is a full frame (PROPOSAL_FRAME or
 *   REPORT_FRAME with overrides merged)
 * @returns {Promise<{ pages: Record<string, number> }>} the page of every contents key
 */
export async function drawProposal(ctx, model, opts = {}) {
  const f = opts.frame ?? PROPOSAL_FRAME;
  const { doc, profile } = ctx;
  await attachLetterhead(ctx, { contact: opts.contact });
  const pages = {};
  const tocEntries = [];

  doc.addPage();
  const style = model.cover.style ?? f.cover.style;
  if (style === 'report') reportCover(ctx, f, model.cover);
  else if (style === 'stacked') stackedCover(ctx, f, model.cover);
  else detailsCover(ctx, f, model.cover);

  if (model.contents) contentsPage(ctx, f, model.contents, pages, tocEntries);

  model.sections.forEach((s, i) => {
    if (i === 0 || s.newPage) doc.addPage();
    else if (s.divider !== false) divider(ctx, f);
    if (s.breakMin !== undefined && needsBreak(ctx, s.breakMin)) doc.addPage();
    if (s.heading) heading(ctx, f, s.level ?? 1, s.heading, { key: s.key, pages, style: s.style });
    for (const b of s.blocks) drawBlock(ctx, f, b, pages);
    s.subsections.forEach((sub, j) => {
      if ((j > 0 || s.blocks.length > 0) && sub.divider !== false) divider(ctx, f);
      if (sub.breakMin !== undefined && needsBreak(ctx, sub.breakMin)) doc.addPage();
      heading(ctx, f, sub.level ?? 2, sub.heading, { key: sub.key, pages, style: sub.style });
      for (const b of sub.blocks) drawBlock(ctx, f, b, pages);
    });
  });

  drawFooters(ctx, opts.footer ?? {});

  // Contents page numbers (legacy post-pass: Regular 11.5 / 11 for sub-entries, right-aligned on the entry line).
  const c = f.contents.page;
  const { start } = doc.bufferedPageRange();
  for (const e of tocEntries) {
    const page = pages[e.key];
    if (page == null) continue;
    doc.switchToPage(start + e.page - 1);
    doc.page.margins.bottom = 0;
    doc.font(c.font).fontSize(e.sub ? c.subSize : c.size).fillColor(col(ctx, c.color))
      .text(String(page), profile.ML, e.y, { align: 'right', width: profile.CW, lineBreak: false });
    doc.page.margins.bottom = profile.MB;
  }
  return { pages };
}
