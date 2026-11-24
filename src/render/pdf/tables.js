// Filled-row tables (legacy offer-letter annexure tables, invoice item table, settlement tables).

/** Default header / row / total styles (offer-letter annexure: row height 22, text at +5, pad 10). */
export const TABLE_DEFAULTS = Object.freeze({
  header: { font: 'BodyBold', size: 9.5, height: 22, padY: 5 },
  row: { font: 'BodyRegular', size: 9.5, height: 22, padX: 10, padY: 5 },
  total: { font: 'BodyBold' },
});

const defined = (obj = {}) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Draw a table and return its bottom y. Columns are laid out left to right from `x`; a column without `width` takes the
 * rest of `CW`. Cell text: left-aligned at `colX + padX` (width `w - padX - padRight`), right-aligned in `w - padX`,
 * centred in `w`. Rows alternate `row.fills`; `totalRows` use the total style (fill `palette.fillTotal`, bold, ink).
 * `row.height: 'auto'` sizes each row to its tallest cell plus `2 * padY` (at least `row.minHeight`). When a row does
 * not fit above `PH - MB - CP`, a page is added and the header repeated (`header.repeat: false` to skip); a header that
 * would end up alone at the bottom of a page moves to the next page with the first row.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ x?: number, y: number, width?: number, columns: Array<{ key: string, label?: string, width?: number,
 *     align?: 'left'|'right'|'center', font?: string, color?: string, padX?: number, padRight?: number }>,
 *   rows: Array<Record<string, any>>, totalRows?: Array<Record<string, any>>,
 *   header?: false|{ fill?: string, color?: string, font?: string, size?: number, height?: number, padY?: number, repeat?: boolean },
 *   row?: { height?: number|'auto', minHeight?: number, fills?: string[]|null, font?: string, color?: string, size?: number,
 *     padX?: number, padY?: number, lineGap?: number, rule?: { color?: string, width?: number }|null },
 *   total?: { fill?: string, font?: string, color?: string }, breakPages?: boolean }} spec
 *   Per-row overrides: `row._style = { fill, font, color }`.
 * @returns {number}
 */
export function drawTable(ctx, spec) {
  const { doc, profile, palette } = ctx;
  const x = spec.x ?? profile.ML;
  const tableW = spec.width ?? profile.CW;
  const header = spec.header === false ? null
    : { fill: palette.ink, color: palette.white, ...TABLE_DEFAULTS.header, repeat: true, ...defined(spec.header) };
  const row = { fills: [palette.fillAlt, palette.white], color: palette.body, rule: null, ...TABLE_DEFAULTS.row, ...defined(spec.row) };
  const total = { fill: palette.fillTotal, color: palette.ink, ...TABLE_DEFAULTS.total, ...defined(spec.total) };
  header && (header.padX ??= row.padX);

  const fixed = spec.columns.reduce((s, c) => s + (c.width ?? 0), 0);
  const flexible = spec.columns.filter((c) => c.width == null).length;
  let cx = x;
  const cols = spec.columns.map((c) => {
    const w = c.width ?? (tableW - fixed) / flexible;
    const col = { align: 'left', padRight: 0, ...c, x: cx, w };
    cx += w;
    return col;
  });

  const cellBox = (col, padX) => {
    const pad = col.padX ?? padX;
    if (col.align === 'right') return { cx: col.x, width: col.w - pad };
    if (col.align === 'center') return { cx: col.x, width: col.w };
    return { cx: col.x + pad, width: col.w - pad - col.padRight };
  };
  const textOpts = (col, width, lineGap) => ({
    width, ...(col.align !== 'left' ? { align: col.align } : {}), ...(lineGap !== undefined ? { lineGap } : {}),
  });

  const drawHeader = (y) => {
    doc.rect(x, y, tableW, header.height).fill(header.fill);
    doc.font(header.font).fontSize(header.size).fillColor(header.color);
    for (const col of cols) {
      const { cx: tx, width } = cellBox(col, header.padX);
      doc.text(col.label ?? '', tx, y + header.padY, textOpts(col, width));
    }
    return y + header.height;
  };

  const cellStyle = (col, style, isTotal) => ({
    font: style.font ?? (isTotal ? total.font : col.font ?? row.font),
    color: style.color ?? (isTotal ? total.color : col.color ?? row.color),
  });

  const rowHeight = (r, style, isTotal) => {
    if (row.height !== 'auto') return row.height;
    let h = 0;
    for (const col of cols) {
      const s = cellStyle(col, style, isTotal);
      const { width } = cellBox(col, row.padX);
      doc.font(s.font).fontSize(row.size);
      h = Math.max(h, doc.heightOfString(String(r[col.key] ?? ''), textOpts(col, width, row.lineGap)));
    }
    return Math.max(h + 2 * row.padY, row.minHeight ?? 0);
  };

  let y = spec.y;
  const { PH, MB, CP } = profile;
  const limit = PH - MB - (CP ?? 0);
  const all = [...spec.rows.map((r) => [r, false]), ...(spec.totalRows ?? []).map((r) => [r, true])];
  if (header) {
    // Never leave a header alone at the bottom of a page.
    const first = all[0] ? rowHeight(all[0][0], all[0][0]._style ?? {}, all[0][1]) : 0;
    if (spec.breakPages !== false && y + header.height + first > limit) {
      doc.addPage();
      y = doc.y;
    }
    y = drawHeader(y);
  }
  all.forEach(([r, isTotal], idx) => {
    const style = r._style ?? {};
    const h = rowHeight(r, style, isTotal);
    if (spec.breakPages !== false && y + h > limit) {
      doc.addPage();
      y = doc.y;
      if (header?.repeat) y = drawHeader(y);
    }
    const fill = style.fill ?? (isTotal ? total.fill : row.fills?.length ? row.fills[idx % row.fills.length] : null);
    if (fill) doc.rect(x, y, tableW, h).fill(fill);
    for (const col of cols) {
      const s = cellStyle(col, style, isTotal);
      const { cx: tx, width } = cellBox(col, row.padX);
      doc.font(s.font).fontSize(row.size).fillColor(s.color)
        .text(String(r[col.key] ?? ''), tx, y + row.padY, textOpts(col, width, row.lineGap));
    }
    y += h;
    if (row.rule) {
      doc.moveTo(x, y).lineTo(x + tableW, y)
        .strokeColor(row.rule.color ?? palette.rule).lineWidth(row.rule.width ?? 0.5).stroke();
    }
  });
  return y;
}
