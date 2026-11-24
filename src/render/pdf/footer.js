// Page footer post-pass (docs/DISCOVERY.md A8 "Shared footer"; legacy proposal script drawFooter + post-pass).
import { brandScope, detachPageHooks } from './document.js';
import { interpolate } from '../../workspace/index.js';

/** Default footer styles (legacy values). */
export const FOOTER_DEFAULTS = Object.freeze({
  font: 'Regular', size: 7.5, ruleOffset: 1, textOffset: 8, ruleWidth: 0.5,
  capsFont: 'SemiBold', capsSpacing: 1.2,
});

/**
 * Draw the footer on every buffered page: rule at `PH-MB+1`, three slots at `PH-MB+8` (left width CW/2, centre, right).
 * Slots default to the brand's `footer.left/center/right`; `{page}` / `{pages}` and brand placeholders are filled; an
 * empty slot is skipped. `centerStyle: 'caps'` prints the centre text upper-case in SemiBold with letter spacing 1.2.
 * Removes the page hooks first, so nothing drawn here can trigger a header.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ left?: string, center?: string, right?: string, centerStyle?: 'plain'|'caps', contact?: string,
 *   rule?: boolean } & Partial<typeof FOOTER_DEFAULTS>} [opts]
 */
export function drawFooters(ctx, opts = {}) {
  const { doc, profile, brand, palette } = ctx;
  const o = { ...FOOTER_DEFAULTS, ...opts };
  const { ML, MR, MT, MB, PW, PH, CW } = profile;
  const slots = {
    left: o.left ?? brand.footer?.left ?? '',
    center: o.center ?? brand.footer?.center ?? '',
    right: o.right ?? brand.footer?.right ?? '',
  };
  const scope = brandScope(brand, o.contact ?? ctx.contact);

  detachPageHooks(ctx);
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.y = MT;

    const fill = (s) => interpolate(s, { ...scope, page: start + i + 1, pages: start + count });
    const left = fill(slots.left);
    let center = fill(slots.center);
    const right = fill(slots.right);
    const lineY = PH - MB + o.ruleOffset;
    const textY = PH - MB + o.textOffset;

    doc.save();
    if (o.rule !== false) {
      doc.moveTo(ML, lineY).lineTo(PW - MR, lineY)
        .strokeColor(palette.ruleStrong).lineWidth(o.ruleWidth).stroke();
    }
    if (left) {
      doc.font(o.font).fontSize(o.size).fillColor(palette.muted)
        .text(left, ML, textY, { width: CW / 2, lineBreak: false });
    }
    if (center) {
      if (o.centerStyle === 'caps') {
        center = center.toUpperCase();
        doc.font(o.capsFont).fontSize(o.size).fillColor(palette.muted)
          .text(center, ML, textY, { align: 'center', width: CW, characterSpacing: o.capsSpacing, lineBreak: false });
      } else {
        doc.font(o.font).fontSize(o.size).fillColor(palette.subtle)
          .text(center, ML, textY, { align: 'center', width: CW, lineBreak: false });
      }
    }
    if (right) {
      doc.font(o.font).fontSize(o.size).fillColor(palette.muted)
        .text(right, ML, textY, { align: 'right', width: CW, lineBreak: false });
    }
    doc.restore();
    doc.page.margins.bottom = savedBottom;
  }
}
