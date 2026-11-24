// Client final settlement statement (docs/DISCOVERY.md A8 §7b): event details, service fee with GST and advance,
// reimbursable expenses, summary and total payable (src/render/statementTemplate.js).
import { clientSettlementModule } from '../../render/statementTemplate.js';

export const { computed, blocks, renderPdf } = clientSettlementModule;
