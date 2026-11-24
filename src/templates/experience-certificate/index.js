// Certificate-style letter (docs/DISCOVERY.md A8 §4): reference and date line, title, salutation, paragraphs and the
// signature block, shared with the other certificates (src/render/letterTemplate.js); wording comes from params.
import { certificateModule } from '../../render/letterTemplate.js';

export const { style, pdfCustom, computed, blocks, renderPdf } = certificateModule;
