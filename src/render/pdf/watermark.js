// Vector watermark over every buffered page (legacy MoU draft watermark; replaces the rasterising watermark.js).
import { detachPageHooks } from './document.js';

/**
 * Draw `text` diagonally across every buffered page, as selectable vector text: centred on `PW/2`, one copy per entry of
 * `rows` (y offsets from `PH/2`), rotated `angle` degrees, filled `color` at `opacity`. Defaults are the MoU draft mark
 * (Bold 38, `palette.label`, opacity 0.14, -30°, rows `PH/2 ± PH/4.5`).
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ text: string, size?: number, opacity?: number, angle?: number, rows?: number[], font?: string, color?: string }} opts
 */
export function drawWatermark(ctx, opts) {
  const { doc, profile, palette } = ctx;
  const { PW, PH } = profile;
  const o = { size: 38, opacity: 0.14, angle: -30, font: 'Bold', color: palette.label, rows: [-PH / 4.5, 0, PH / 4.5], ...opts };
  if (!o.text) return;
  detachPageHooks(ctx);
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const saved = { top: doc.page.margins.top, bottom: doc.page.margins.bottom };
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;
    doc.font(o.font).fontSize(o.size);
    const textWidth = doc.widthOfString(o.text);
    const textHeight = doc.currentLineHeight();
    for (const yOff of o.rows) {
      doc.save();
      doc.translate(PW / 2, PH / 2 + yOff);
      doc.rotate(o.angle);
      doc.fillColor(o.color);
      doc.fillOpacity(o.opacity);
      doc.text(o.text, -textWidth / 2, -textHeight / 2, { lineBreak: false });
      doc.restore();
    }
    doc.page.margins.top = saved.top;
    doc.page.margins.bottom = saved.bottom;
  }
}
