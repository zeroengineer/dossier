// Remittance statement (docs/DISCOVERY.md A8 §8): a one-page letter confirming a transfer, with the transaction and
// receiving-account details and the signature (src/render/statementTemplate.js).
import { remittanceModule } from '../../render/statementTemplate.js';

export const { computed, blocks, renderPdf } = remittanceModule;
