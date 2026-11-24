// PDF render primitives: one import for templates.
export { PROFILES, getProfile } from './profiles.js';
export { createPdf, finalizePdf, onPageAdded, detachPageHooks, brandScope, PRODUCER } from './document.js';
export { loadImage, placeImage, clearImageCache, brandImages } from './images.js';
export { createFormatter, indianWords } from './format.js';
export { drawLetterhead, attachLetterhead, LETTERHEAD_DEFAULTS } from './letterhead.js';
export { drawFooters, FOOTER_DEFAULTS } from './footer.js';
export {
  tokenize, layoutParagraph, renderParagraph, richText, richBullets, needsBreak, sectionHeader, clauseHeader, divider,
  PARAGRAPH_DEFAULTS, BULLET_DEFAULTS, SECTION_DEFAULTS, CLAUSE_DEFAULTS, DIVIDER_DEFAULTS, AMOUNT_EMPHASIS_DEFAULTS,
} from './text.js';
export { drawTable, TABLE_DEFAULTS } from './tables.js';
export { drawSignatureBlock, SIGNATURE_DEFAULTS } from './signature.js';
export { drawWatermark } from './watermark.js';
