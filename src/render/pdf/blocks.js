// Render the shared block model into a PDF with the Task 10 primitives (docs/TEMPLATES.md "Blocks").
import { normaliseTable, paletteColour, resolveBlockStyle, validateBlocks } from '../blocks.js';
import { drawSignatureBlock, SIGNATURE_DEFAULTS } from './signature.js';
import { drawTable } from './tables.js';
import { divider, needsBreak, renderParagraph, richBullets, richText, sectionHeader } from './text.js';

/**
 * Draw blocks from the current cursor. Adds the first page when the document has none (letterhead hooks attached
 * before this call run for it). `style` deep-merges over BLOCK_STYLE_DEFAULTS (offer-letter values).
 * @param {import('./document.js').PdfContext} ctx
 * @param {Array<object>} blocks
 * @param {object} [style] see BLOCK_STYLE_DEFAULTS in src/render/blocks.js
 * @param {{ custom?: Record<string, (ctx: object, data: object, style: object) => unknown> }} [opts]
 *   draw functions for `custom` blocks (the template module's `pdfCustom`)
 * @returns {Promise<void>}
 */
export async function renderBlocksPdf(ctx, blocks, style = {}, opts = {}) {
  validateBlocks(blocks);
  const s = resolveBlockStyle(style);
  const { doc, profile, palette } = ctx;
  const col = (c) => paletteColour(palette, c);
  const para = (ps, extra = {}) => ({
    fontSize: ps.fontSize, lineGap: ps.lineGap, align: ps.align, moveDown: ps.moveDown, regularFont: ps.regularFont,
    boldFont: ps.boldFont, fillColor: col(ps.color), boldColor: col(ps.boldColor), maxSpaceRatio: ps.maxSpaceRatio,
    noJustifyUnderscores: ps.noJustifyUnderscores, amountEmphasis: ps.amountEmphasis, ...extra,
  });

  if (ctx.pageNumber === 0) doc.addPage();
  for (const b of blocks) {
    doc.x = profile.ML;
    switch (b.type) {
      case 'heading': {
        const hs = { ...s.heading[b.level], ...(b.cover ? s.coverHeading?.[b.level] : {}), ...(b.align ? { align: b.align } : {}) };
        sectionHeader(ctx, String(b.text), { ...hs, color: col(hs.color) });
        break;
      }
      case 'paragraph': {
        const ps = { ...s.paragraph, ...(b.cover ? s.coverParagraph : {}), ...(b.align ? { align: b.align } : {}) };
        richText(ctx, String(b.text), para(ps));
        break;
      }
      case 'bullets':
        richBullets(ctx, b.items.map(String), { ...para(s.paragraph), ...s.bullets, bulletColor: col(s.bullets.bulletColor) });
        break;
      case 'numbered':
        numbered(ctx, b.items.map(String), s.numbered, para(s.paragraph), col);
        break;
      case 'table':
        table(ctx, b, s.table, col);
        break;
      case 'keyValue':
        keyValue(ctx, b.rows, s.keyValue, col);
        break;
      case 'signature':
        await signature(ctx, b, s.signature, col);
        break;
      case 'spacer':
        if (needsBreak(ctx, b.size)) doc.addPage();
        else doc.y += b.size;
        break;
      case 'divider':
        divider(ctx, { ...s.divider, color: col(s.divider.color) });
        break;
      case 'pageBreak':
        doc.addPage();
        break;
      case 'custom': {
        const fn = opts.custom?.[b.name];
        if (typeof fn !== 'function') throw new Error(`renderBlocksPdf: no PDF draw function for custom block "${b.name}"`);
        await fn(ctx, b.data ?? {}, s);
        break;
      }
      default:
        break;
    }
  }
  doc.x = profile.ML;
}

/** Numbered list: like richBullets with `1.`, `2.` … markers at `ML + bulletX`, text at `+ indent`. */
function numbered(ctx, items, o, p, col) {
  const { doc, profile } = ctx;
  const x = profile.ML + o.bulletX;
  const width = profile.CW - o.bulletX - o.indent;
  const item = { ...p, moveDown: o.itemMoveDown };
  items.forEach((text, i) => {
    if (needsBreak(ctx, o.breakMin)) doc.addPage();
    const startY = doc.y;
    doc.font(o.bulletFont).fontSize(o.bulletSize).fillColor(col(o.bulletColor) ?? p.fillColor)
      .text(`${i + 1}.`, x, startY, { width: o.indent, lineBreak: false });
    doc.y = startY;
    renderParagraph(ctx, text, x + o.indent, width, item);
  });
  doc.moveDown(o.moveDown);
}

function table(ctx, b, o, col) {
  const { doc, profile } = ctx;
  const t = normaliseTable(b);
  doc.moveDown(o.before);
  const colours = (part) => (part ? { ...part, fill: col(part.fill), color: col(part.color) } : part);
  const bottom = drawTable(ctx, {
    y: doc.y,
    columns: t.columns.map((c) => ({ key: c.key, label: c.label, width: c.width, align: c.align === 'justify' ? 'left' : c.align, font: c.font, color: col(c.color) })),
    rows: t.rows,
    totalRows: t.totalRows,
    header: b.header === false ? false : colours(o.header),
    row: { ...o.row, fills: o.row.fills?.map(col) ?? null, color: col(o.row.color) },
    total: colours(o.total),
  });
  doc.x = profile.ML;
  doc.y = bottom;
  doc.moveDown(o.after);
}

function keyValue(ctx, rows, o, col) {
  const { doc, profile } = ctx;
  const x = profile.ML + o.indent;
  const valueX = x + o.labelWidth;
  const valueW = profile.CW - o.indent - o.labelWidth;
  doc.moveDown(o.before);
  for (const [k, v] of rows) {
    const value = `${o.separator}${v ?? ''}`;
    doc.font(o.valueFont).fontSize(o.size);
    const h = Math.max(o.rowHeight, doc.heightOfString(value, { width: valueW }));
    if (needsBreak(ctx, h)) doc.addPage();
    const y = doc.y;
    doc.font(o.labelFont).fontSize(o.size).fillColor(col(o.labelColor)).text(String(k ?? ''), x, y, { width: o.labelWidth });
    doc.font(o.valueFont).fontSize(o.size).fillColor(col(o.valueColor)).text(value, valueX, y, { width: valueW });
    doc.y = y + h;
  }
  doc.x = profile.ML;
  doc.moveDown(o.after);
}

async function signature(ctx, b, o, col) {
  const { doc, profile } = ctx;
  const lines = (b.lines ?? []).map(String);
  if (b.signatoryId) {
    const blockOpts = o.block ?? {};
    const offsets = { ...SIGNATURE_DEFAULTS.offsets, ...blockOpts.offsets };
    const imageHeight = blockOpts.imageHeight ?? SIGNATURE_DEFAULTS.imageHeight;
    const height = o.gap + offsets.image + imageHeight + offsets.name + offsets.title + o.lineStep * (lines.length + 1);
    if (needsBreak(ctx, height)) doc.addPage();
    const { bottom } = await drawSignatureBlock(ctx, {
      ...blockOpts,
      y: doc.y + o.gap,
      signatoryId: b.signatoryId,
      ...(b.party !== undefined ? { forLine: String(b.party) } : {}),
      extraLines: lines.map((text, i) => ({
        text, dy: offsets.title + o.lineStep * (i + 1), font: o.lineFont, size: o.lineSize, color: col(o.lineColor),
      })),
    });
    doc.y = bottom;
  } else {
    const height = o.gap + o.signLineGap + o.lineStep * (lines.length + 2);
    if (needsBreak(ctx, height)) doc.addPage();
    const y = doc.y + o.gap;
    doc.font(o.partyFont).fontSize(o.partySize).fillColor(col('ink')).text(String(b.party ?? ''), profile.ML, y, { width: profile.CW });
    const lineY = y + o.signLineGap;
    doc.moveTo(profile.ML, lineY).lineTo(profile.ML + o.signLineWidth, lineY).strokeColor(col(o.signLineColor)).lineWidth(0.5).stroke();
    let ly = lineY + 6;
    for (const text of lines) {
      doc.font(o.lineFont).fontSize(o.lineSize).fillColor(col(o.lineColor)).text(text, profile.ML, ly, { width: profile.CW });
      ly = doc.y;
    }
    doc.y = ly;
  }
  doc.x = profile.ML;
  doc.moveDown(o.after);
}
