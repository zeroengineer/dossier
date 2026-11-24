// Ticket pricing report (docs/DISCOVERY.md A8 §14): cover, contents with page numbers and data-driven sections with the
// Delegate Paid / Organiser Paid fee calculator tables (src/render/proposalTemplate.js).
import { proposalModule } from '../../render/proposalTemplate.js';

export const { computed, style, blocks, renderPdf } = proposalModule('report');
