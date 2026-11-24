// Employee final settlement statement (docs/DISCOVERY.md A8 §6b): the letterhead variant with the boxed two-column
// tables, net box and signature row; computations and drawing are shared (src/render/statementTemplate.js).
import { employeeSettlementModule } from '../../render/statementTemplate.js';

export const { computed, blocks, renderPdf } = employeeSettlementModule;
