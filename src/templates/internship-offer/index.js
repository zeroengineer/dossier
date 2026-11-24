// Internship offer (docs/DISCOVERY.md A8 §3): the offer-family letter without an annexure, with the internship body
// metrics (lineGap 4, paragraphs 0.7 lines apart, clause headings kept with 45 pt). Wording comes from params.
import {
  INTERNSHIP_STYLE, LETTER_PDF_CUSTOM, OFFER_FOOTER, checkContent, letterRenderPdf, offerFamilyBlocks,
} from '../../render/letterTemplate.js';

export const style = INTERNSHIP_STYLE;
export const pdfCustom = LETTER_PDF_CUSTOM;
export const computed = { content: checkContent };

/**
 * Blocks of the internship offer.
 * @param {object} values @param {object} env
 */
export function blocks(values, env) {
  return offerFamilyBlocks(values, env);
}

export const renderPdf = letterRenderPdf(blocks, { style, footer: OFFER_FOOTER });
