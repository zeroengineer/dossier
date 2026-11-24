// Letter-family page header (docs/DISCOVERY.md A8 "Shared letterhead"; legacy generate-proposal.js drawHeader).
import { brandScope, onPageAdded } from './document.js';
import { interpolate } from '../../workspace/index.js';

/** Default letterhead styles (legacy values). */
export const LETTERHEAD_DEFAULTS = Object.freeze({
  nameFont: 'Bold', nameSize: 8.5, lineFont: 'Regular', lineSize: 8,
  firstGap: 1, lineGap: 0.5, ruleOffset: 6, ruleWidth: 0.3, logoResizeHeight: 80,
});

/**
 * Text block height: name line + firstGap + N lines separated by lineGap. Summed in the legacy order
 * (`lhBold + 1 + lhReg + 0.5 + lhReg + …`) so the floating-point result is identical.
 */
function blockHeight(lhName, lhLine, n, firstGap, lineGap) {
  let h = lhName;
  for (let i = 0; i < n; i++) h = h + (i === 0 ? firstGap : lineGap) + lhLine;
  return h;
}

/**
 * Draw the letterhead on the current page: logo at the left, vertically centred against a right-aligned block of the
 * legal name and the brand's `letterhead.lines` (with `{contact.*}` from the chosen contact), then a hairline rule.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ contact?: string, logo: { buffer: Buffer } } & Partial<typeof LETTERHEAD_DEFAULTS>} opts
 * @returns {{ textY: number, textBlockH: number, ruleY: number }}
 */
export function drawLetterhead(ctx, opts) {
  const { doc, profile, brand, palette } = ctx;
  const o = { ...LETTERHEAD_DEFAULTS, ...opts };
  if (!o.logo?.buffer) throw new Error('drawLetterhead: opts.logo (a prepared image) is required');
  const { ML, MR, MT, PW, CW } = profile;
  const LOGO_H = profile.LOGO_H ?? 32;
  const scope = brandScope(brand, o.contact ?? ctx.contact);
  const lines = (brand.letterhead?.lines ?? []).map((l) => interpolate(l, scope));

  doc.font(o.nameFont).fontSize(o.nameSize);
  const lhName = doc.currentLineHeight(true);
  doc.font(o.lineFont).fontSize(o.lineSize);
  const lhLine = doc.currentLineHeight(true);

  const textBlockH = blockHeight(lhName, lhLine, lines.length, o.firstGap, o.lineGap);
  const textY = (MT - textBlockH) / 2;
  const logoY = textY + (textBlockH - LOGO_H) / 2;

  doc.image(o.logo.buffer, ML, logoY, { height: LOGO_H });

  doc.font(o.nameFont).fontSize(o.nameSize).fillColor(palette.ink)
    .text(brand.legalName, ML, textY, { align: 'right', width: CW });

  doc.font(o.lineFont).fontSize(o.lineSize).fillColor(palette.label);
  lines.forEach((line, i) => {
    doc.text(line, ML, doc.y + (i === 0 ? o.firstGap : o.lineGap), { align: 'right', width: CW });
  });

  const ruleY = textY + textBlockH + o.ruleOffset;
  doc.moveTo(ML, ruleY).lineTo(PW - MR, ruleY)
    .strokeColor(palette.rule).lineWidth(o.ruleWidth).stroke();
  return { textY, textBlockH, ruleY };
}

/**
 * Prepare the logo (sharp height 80) and draw the letterhead on every page added from now on, then place the cursor at
 * `MT + CP`. The hook is removed by drawFooters / finalizePdf.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ contact?: string, contentTop?: number } & Partial<typeof LETTERHEAD_DEFAULTS>} [opts]
 *   `contentTop` overrides where the cursor starts (default `MT + CP`).
 * @returns {Promise<void>}
 */
export async function attachLetterhead(ctx, opts = {}) {
  const o = { ...LETTERHEAD_DEFAULTS, ...opts };
  const logo = await ctx.assets.logo({ resizeHeight: o.logoResizeHeight });
  const { MT, CP } = ctx.profile;
  onPageAdded(ctx, () => {
    drawLetterhead(ctx, { ...o, logo });
    ctx.doc.y = o.contentTop ?? MT + (CP ?? 0);
  });
}
