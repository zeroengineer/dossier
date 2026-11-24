// Markdown-bodied memorandum of understanding, drawn as the legacy v2 MoU script (docs/DISCOVERY.md A8 §12, the
// canonical organisation MoU and its event variant): no letterhead, cover (blocks before the first divider) centred,
// slate headings, justified 10.2 pt body with `**bold**` and currency-amount emphasis, keep-together thresholds for
// named sections, auto-height tables, side-by-side signature cards and a right-aligned `Page i of n` footer. Every
// size, offset and colour is in MOU_FRAME, which a template's `params.frame` deep-merges over (colours are palette keys
// or hex values). The blocks come from parseMarkdownBlocks (src/render/md/parse.js).
import { mergeStyle, paletteColour } from '../blocks.js';
import { detachPageHooks } from './document.js';
import { drawWatermark } from './watermark.js';
import { layoutParagraph, needsBreak, renderParagraph, richBullets } from './text.js';

/** Legacy v2 MoU layout (organisation MoU script; the event variant changes `signature.cardHeight` and `fields`). */
export const MOU_FRAME = Object.freeze({
  heading: {
    1: { font: 'ExtraBold', size: 14.5, color: '#0f172a', lineGap: 2, before: 0.25, after: 0.28, breakMin: 65 },
    2: { font: 'Bold', size: 12, color: '#1e293b', lineGap: 1.5, before: 0.18, after: 0.22, breakMin: 55 },
    3: { font: 'SemiBold', size: 11, color: '#334155', lineGap: 1.5, before: 0.12, after: 0.18, breakMin: 40 },
  },
  coverHeading: {
    1: { font: 'ExtraBold', size: 18, color: '#0f172a', lineGap: 3, before: 0.15, after: 0.35, breakMin: 80 },
    2: { font: 'Bold', size: 13, color: '#1e293b', lineGap: 2, before: 0.18, after: 0.28, breakMin: 50 },
    3: { font: 'SemiBold', size: 11, color: '#334155', lineGap: 1.5, before: 0.12, after: 0.18, breakMin: 40 },
  },
  // `h1` text containing a key needs that many points left on the page, else it starts a new page (first match wins).
  keepTogether: { 'ORGANISATION DETAILS': 450, 'EVENT DETAILS': 450, WITNESS: 260, 'DATA & PLATFORM USE': 160 },
  paragraph: {
    fontSize: 10.2, lineGap: 5.6, color: '#334155', boldColor: '#0f172a', regularFont: 'Regular', boldFont: 'Bold',
    align: 'justify', moveDown: 0.32, maxSpaceRatio: 2.2, noJustifyUnderscores: true,
    amount: { font: 'ExtraBold', sizeDelta: 0.5, dy: -0.3, color: '#0f172a' },
  },
  // `align: 'auto'`: a cover paragraph that wraps, or contains one of `justifyContaining`, is justified; others are
  // centred (the legacy script justified the party paragraphs and centred the rest).
  cover: { fontSize: 10.5, lineGap: 5.6, moveDown: 0.35, align: 'auto', justifyContaining: ['Party'] },
  bullets: {
    bullet: '•', bulletFont: 'SemiBold', bulletSize: 10.2, bulletColor: '#475569', bulletX: 4, indent: 14,
    lineGap: 5.4, itemMoveDown: 0.18, moveDown: 0.24,
  },
  numbered: { bulletFont: 'SemiBold', bulletColor: '#475569', bulletX: 4, indent: 18 },
  divider: { breakMin: 18, before: 0.15, after: 0.22, color: '#cbd5e1', lineWidth: 0.5 },
  table: {
    labelColumn: 135, valueColumn: 130, labelHeaders: ['particular'], padX: 8, padY: 6.5, minRowHeight: 22,
    breakPad: 12, rowBreakPad: 8, before: 0.12, after: 8,
    header: { font: 'Bold', size: 9.8, color: '#ffffff', fill: '#1e293b' },
    row: { font: 'Regular', boldFont: 'Bold', size: 9.3, color: '#334155', boldColor: '#1e293b', fills: ['#ffffff', '#f8fafc'] },
    rule: { color: '#e2e8f0', width: 0.4 },
    strong: { patterns: ['amount received', 'net', 'final amount'], fill: '#f1f5f9', color: '#0f172a', rule: '#94a3b8', ruleWidth: 0.75 },
    closingRule: { color: '#cbd5e1', width: 0.75 },
  },
  signature: {
    breakMin: 220, before: 0.12, dy: 6, gap: 20, cardHeight: 188, radius: 5, fill: '#f8fafc', stroke: '#e2e8f0', pad: 12,
    title: { font: 'Bold', size: 10, color: '#0f172a', lineGap: 1.5, after: 16 },
    rule: { color: '#cbd5e1', width: 0.5 },
    label: { text: 'Authorized Signatory', font: 'Bold', size: 9.5, color: '#475569', dy: 10 },
    signLine: { dy: 28, length: 128, color: '#94a3b8', width: 0.5 },
    fields: ['Name', 'Designation', 'Date', 'Seal'],
    field: { dy: 10, step: 16, font: 'Medium', size: 9, color: '#334155' },
    value: { font: 'SemiBold', size: 8.5, color: '#0f172a', dx: 5, dy: 0.5, rightPad: 31 },
    blank: { dx: 4, dy: 9, rightPad: 14, color: '#cbd5e1', width: 0.5 },
    rowGap: 10,
  },
  footer: {
    ruleDy: -34, textDy: 6, rule: '#e2e8f0', ruleWidth: 0.5, font: 'Regular', size: 7.5, color: '#64748b',
    left: '', center: '', right: 'Page {page} of {pages}',
  },
});

const col = (ctx, c) => paletteColour(ctx.palette, c);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function paragraphOpts(ctx, f, over = {}) {
  const p = { ...f.paragraph, ...over };
  return {
    fontSize: p.fontSize, lineGap: p.lineGap, fillColor: col(ctx, p.color), boldColor: col(ctx, p.boldColor),
    regularFont: p.regularFont, boldFont: p.boldFont, align: p.align, moveDown: p.moveDown,
    maxSpaceRatio: p.maxSpaceRatio, noJustifyUnderscores: p.noJustifyUnderscores,
    amountEmphasis: p.amount ? { ...p.amount, color: col(ctx, p.amount.color) } : false,
  };
}

function heading(ctx, text, h, breakMin = h.breakMin, align) {
  const { doc, profile } = ctx;
  if (needsBreak(ctx, breakMin)) doc.addPage();
  doc.moveDown(h.before);
  doc.font(h.font).fontSize(h.size).fillColor(col(ctx, h.color))
    .text(text, profile.ML, doc.y, { width: profile.CW, lineGap: h.lineGap, ...(align ? { align } : {}) });
  doc.moveDown(h.after);
}

function keepTogether(f, text) {
  for (const [key, min] of Object.entries(f.keepTogether ?? {})) if (text.includes(key)) return min;
  return f.heading[1].breakMin;
}

function divider(ctx, d) {
  const { doc, profile } = ctx;
  if (needsBreak(ctx, d.breakMin)) {
    doc.addPage();
    return;
  }
  doc.moveDown(d.before);
  doc.moveTo(profile.ML, doc.y).lineTo(profile.PW - profile.MR, doc.y).strokeColor(col(ctx, d.color)).lineWidth(d.lineWidth).stroke();
  doc.moveDown(d.after);
}

function coverParagraph(ctx, f, text) {
  const { profile } = ctx;
  const c = f.cover;
  let align = c.align;
  if (align === 'auto' && (c.justifyContaining ?? []).some((k) => text.includes(k))) align = 'justify';
  if (align === 'auto') {
    const probe = paragraphOpts(ctx, f, { fontSize: c.fontSize, lineGap: c.lineGap, align: 'justify' });
    align = layoutParagraph(ctx, text, profile.CW, probe).lines.length > 1 ? 'justify' : 'center';
  }
  renderParagraph(ctx, text, profile.ML, profile.CW, paragraphOpts(ctx, f, { fontSize: c.fontSize, lineGap: c.lineGap, moveDown: c.moveDown, align }));
}

function bullets(ctx, f, items) {
  const b = f.bullets;
  richBullets(ctx, items, {
    ...paragraphOpts(ctx, f, { lineGap: b.lineGap }), bullet: b.bullet, bulletFont: b.bulletFont, bulletSize: b.bulletSize,
    bulletColor: col(ctx, b.bulletColor), bulletX: b.bulletX, indent: b.indent, itemMoveDown: b.itemMoveDown, moveDown: b.moveDown,
    keepTogether: true,
  });
}

function numbered(ctx, f, items) {
  const b = { ...f.bullets, ...f.numbered };
  const opts = {
    ...paragraphOpts(ctx, f, { lineGap: b.lineGap }), bulletFont: b.bulletFont, bulletSize: b.bulletSize,
    bulletColor: col(ctx, b.bulletColor), bulletX: b.bulletX, indent: b.indent, itemMoveDown: b.itemMoveDown, moveDown: 0,
    keepTogether: true,
  };
  items.forEach((item, i) => richBullets(ctx, [item], { ...opts, bullet: `${i + 1}.` }));
  ctx.doc.moveDown(b.moveDown);
}

/**
 * True when a table row is a total/net row: some cell contains one of `patterns` as whole words (case-insensitive),
 * so `net` matches "Net amount" and "(Net)" but not "Internet" or "Network".
 * @param {string[]} row @param {string[]} patterns
 */
export function isStrongRow(row, patterns) {
  const res = (patterns ?? []).map((p) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, 'iu'));
  return row.some((cell) => res.some((re) => re.test(String(cell).replace(/\*\*/g, ''))));
}

/** Auto-height table (legacy drawTable): two columns get a fixed label or value column, more share the width. */
function table(ctx, t, block) {
  const { doc, profile } = ctx;
  const { ML, CW } = profile;
  const headers = block.columns.map((c) => (typeof c === 'string' ? c : c.label));
  const aligns = block.columns.map((c) => (typeof c === 'string' ? 'left' : c.align ?? 'left'));
  const rows = block.rows.map((r) => (Array.isArray(r) ? r : headers.map((_, i) => r[i] ?? '')).map((c) => String(c ?? '')));
  const n = headers.length;
  let widths;
  if (n === 2) {
    const labelFirst = t.labelHeaders.some((h) => headers[0].toLowerCase().includes(h.toLowerCase()));
    widths = labelFirst ? [t.labelColumn, CW - t.labelColumn] : [CW - t.valueColumn, t.valueColumn];
  } else {
    widths = headers.map(() => CW / n);
  }
  const isStrong = (row) => isStrongRow(row, t.strong.patterns);
  const cellH = (text, w, size, bold) => {
    doc.font(bold ? t.row.boldFont : t.row.font).fontSize(size);
    return Math.max(doc.heightOfString(text.replace(/\*\*/g, ''), { width: w - t.padX * 2 }) + t.padY * 2, t.minRowHeight);
  };
  let headerH = 0;
  headers.forEach((h, c) => { headerH = Math.max(headerH, cellH(h, widths[c], t.header.size, true)); });
  const rowHeights = rows.map((row) => {
    const strong = isStrong(row);
    return Math.max(0, ...row.map((cell, c) => cellH(cell, widths[c], t.row.size, strong)));
  });
  const total = headerH + rowHeights.reduce((a, b) => a + b, 0);
  if (needsBreak(ctx, total + t.breakPad)) doc.addPage();

  doc.moveDown(t.before);
  let y = doc.y;
  doc.rect(ML, y, CW, headerH).fill(col(ctx, t.header.fill));
  let x = ML;
  headers.forEach((h, c) => {
    doc.font(t.header.font).fontSize(t.header.size).fillColor(col(ctx, t.header.color))
      .text(h, x + t.padX, y + t.padY, { width: widths[c] - t.padX * 2, align: aligns[c] });
    x += widths[c];
  });
  y += headerH;
  doc.y = y;

  rows.forEach((row, r) => {
    const h = rowHeights[r];
    const strong = isStrong(row);
    if (needsBreak(ctx, h + t.rowBreakPad)) {
      doc.addPage();
      y = doc.y;
    }
    doc.rect(ML, y, CW, h).fill(col(ctx, strong ? t.strong.fill : t.row.fills[r % t.row.fills.length]));
    doc.moveTo(ML, y).lineTo(ML + CW, y)
      .strokeColor(col(ctx, strong ? t.strong.rule : t.rule.color)).lineWidth(strong ? t.strong.ruleWidth : t.rule.width).stroke();
    let cx = ML;
    row.forEach((cell, c) => {
      const bold = (cell.startsWith('**') && cell.endsWith('**')) || strong;
      doc.font(bold ? t.row.boldFont : t.row.font).fontSize(t.row.size)
        .fillColor(col(ctx, strong ? t.strong.color : bold ? t.row.boldColor : t.row.color))
        .text(cell.replace(/\*\*/g, ''), cx + t.padX, y + t.padY, { width: widths[c] - t.padX * 2, align: aligns[c] });
      cx += widths[c];
    });
    y += h;
    doc.y = y;
  });
  doc.moveTo(ML, y).lineTo(ML + CW, y).strokeColor(col(ctx, t.closingRule.color)).lineWidth(t.closingRule.width).stroke();
  doc.y = y + t.after;
}

/**
 * Field values of a signature section: lines such as `Name: Sam Sample` (several `Label: value` pairs on one line are
 * split). A value made only of underscores counts as empty (a ruled line is drawn instead).
 * @param {string[]} lines @param {string[]} labels
 * @returns {Record<string, string>} lower-case label -> value
 */
export function signatureValues(lines, labels) {
  const out = {};
  if (!labels.length) return out;
  const alt = labels.map(escapeRe).join('|');
  const start = new RegExp(`^(${alt})\\s*:`, 'i');
  const split = new RegExp(`\\s+(?=(?:${alt})\\s*:)`, 'i');
  const pair = new RegExp(`^(${alt})\\s*:\\s*(.*)$`, 'i');
  for (const line of lines ?? []) {
    const clean = String(line).replace(/\*\*/g, '').trim();
    if (!start.test(clean)) continue;
    for (const part of clean.split(split)) {
      const m = pair.exec(part.trim());
      if (m && !/^_*$/.test(m[2].trim())) out[m[1].toLowerCase()] = m[2].trim();
    }
  }
  return out;
}

/** Two signature cards side by side (legacy drawSignatureBlocks); `right` may be null (a blank card). */
function signatureCards(ctx, s, left, right) {
  const { doc, profile } = ctx;
  const { ML, CW } = profile;
  if (needsBreak(ctx, s.breakMin)) doc.addPage();
  doc.moveDown(s.before);
  const startY = doc.y + s.dy;
  const colW = CW / 2 - s.gap / 2;
  const parties = [[ML, left], [ML + colW + s.gap, right ?? { party: '', lines: [] }]];
  for (const [x] of parties) doc.roundedRect(x, startY, colW, s.cardHeight, s.radius).fillAndStroke(col(ctx, s.fill), col(ctx, s.stroke));
  const pad = s.pad;
  let headH = 0;
  for (const [x, p] of parties) {
    doc.font(s.title.font).fontSize(s.title.size).fillColor(col(ctx, s.title.color));
    doc.text(p.party ?? '', x + pad, startY + pad, { width: colW - pad * 2, lineGap: s.title.lineGap });
    headH = Math.max(headH, doc.heightOfString(p.party ?? '', { width: colW - pad * 2 }));
  }
  const lineY = startY + headH + s.title.after;
  for (const [x] of parties) {
    doc.moveTo(x + pad, lineY).lineTo(x + colW - pad, lineY).strokeColor(col(ctx, s.rule.color)).lineWidth(s.rule.width).stroke();
  }
  const labelY = lineY + s.label.dy;
  for (const [x] of parties) {
    doc.font(s.label.font).fontSize(s.label.size).fillColor(col(ctx, s.label.color)).text(s.label.text, x + pad, labelY);
  }
  const signY = labelY + s.signLine.dy;
  for (const [x] of parties) {
    doc.moveTo(x + pad, signY).lineTo(x + pad + s.signLine.length, signY).strokeColor(col(ctx, s.signLine.color)).lineWidth(s.signLine.width).stroke();
  }
  const values = parties.map(([x, p]) => [x, signatureValues(p.lines, s.fields)]);
  let fieldY = signY + s.field.dy;
  for (const label of s.fields) {
    const text = `${label}:`;
    for (const [x, vals] of values) {
      doc.font(s.field.font).fontSize(s.field.size).fillColor(col(ctx, s.field.color));
      doc.text(text, x + pad, fieldY, { lineBreak: false });
      const lW = doc.widthOfString(text);
      const val = vals[label.toLowerCase()];
      if (val) {
        doc.font(s.value.font).fontSize(s.value.size).fillColor(col(ctx, s.value.color));
        doc.text(val, x + pad + s.value.dx + lW, fieldY + s.value.dy, { width: colW - s.value.rightPad - lW, lineBreak: false, ellipsis: true });
      } else {
        doc.moveTo(x + pad + s.blank.dx + lW, fieldY + s.blank.dy).lineTo(x + colW - s.blank.rightPad, fieldY + s.blank.dy)
          .strokeColor(col(ctx, s.blank.color)).lineWidth(s.blank.width).stroke();
      }
    }
    fieldY += s.field.step;
  }
  doc.y = startY + s.cardHeight + s.rowGap;
}

/** Footer post-pass: rule at `PH + ruleDy`, text slots at `+ textDy` (`{page}`, `{pages}` and brand keys filled). */
function footers(ctx, ft) {
  const { doc, profile } = ctx;
  const { ML, MR, PW, PH, CW } = profile;
  detachPageHooks(ctx);
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const saved = { top: doc.page.margins.top, bottom: doc.page.margins.bottom };
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;
    const lineY = PH + ft.ruleDy;
    const textY = lineY + ft.textDy;
    doc.save();
    doc.moveTo(ML, lineY).lineTo(PW - MR, lineY).strokeColor(col(ctx, ft.rule)).lineWidth(ft.ruleWidth).stroke();
    const fill = (str) => ctx.interp(str ?? '', { page: start + i + 1, pages: start + count });
    for (const [slot, align] of [['left', 'left'], ['center', 'center'], ['right', 'right']]) {
      const text = fill(ft[slot]);
      if (!text) continue;
      doc.font(ft.font).fontSize(ft.size).fillColor(col(ctx, ft.color)).text(text, ML, textY, { align, width: CW, lineBreak: false });
    }
    doc.restore();
    doc.page.margins.top = saved.top;
    doc.page.margins.bottom = saved.bottom;
  }
}

/**
 * Draw a MoU from Markdown blocks: cover blocks centred, headings h1–h3, paragraphs, bullets, numbered items, tables,
 * dividers; signature blocks are collected and drawn after the body as cards, two per row; then the footer on every
 * page and, when `watermark` is given, the diagonal watermark (drawWatermark options).
 * @param {import('./document.js').PdfContext} ctx
 * @param {Array<object>} blocks parseMarkdownBlocks output
 * @param {{ frame?: object, watermark?: { text: string } & object | null }} [opts]
 */
export function drawMou(ctx, blocks, { frame = {}, watermark = null } = {}) {
  const f = mergeStyle(MOU_FRAME, frame ?? {});
  const { doc } = ctx;
  doc.addPage();
  const signatures = [];
  for (const b of blocks) {
    if (b.type === 'signature') {
      signatures.push(b);
      continue;
    }
    if (b.type === 'divider') {
      divider(ctx, f.divider);
      continue;
    }
    if (b.cover) {
      if (b.type === 'heading') heading(ctx, b.text, f.coverHeading[b.level], undefined, 'center');
      else if (b.type === 'paragraph') coverParagraph(ctx, f, b.text);
      else if (b.type === 'bullets') bullets(ctx, f, b.items);
      else if (b.type === 'numbered') numbered(ctx, f, b.items);
      else if (b.type === 'table') table(ctx, f.table, b);
      continue;
    }
    if (b.type === 'heading') heading(ctx, b.text, f.heading[b.level], b.level === 1 ? keepTogether(f, b.text) : undefined);
    else if (b.type === 'paragraph') renderParagraph(ctx, b.text, ctx.profile.ML, ctx.profile.CW, paragraphOpts(ctx, f));
    else if (b.type === 'bullets') bullets(ctx, f, b.items);
    else if (b.type === 'numbered') numbered(ctx, f, b.items);
    else if (b.type === 'table') table(ctx, f.table, b);
  }
  for (let i = 0; i < signatures.length; i += 2) signatureCards(ctx, f.signature, signatures[i], signatures[i + 1] ?? null);
  footers(ctx, f.footer);
  if (watermark?.text) drawWatermark(ctx, watermark);
}
