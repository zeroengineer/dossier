// Service proposal / quotation (docs/DISCOVERY.md A8 §13, gen-2 layout): cover, contents with page numbers and
// data-driven sections with fee cards, price cards, fee calculator tables and the sign-off (src/render/proposalTemplate.js).
import { proposalModule } from '../../render/proposalTemplate.js';

export const { computed, style, blocks, renderPdf } = proposalModule('proposal');
