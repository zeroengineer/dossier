// Expense statement (docs/DISCOVERY.md A8 §10): a letter listing reimbursable expenses and charges with the amount in
// words, the bank account to pay into and the sign-off (src/render/statementTemplate.js).
import { expenseModule } from '../../render/statementTemplate.js';

export const { computed, blocks, renderPdf } = expenseModule;
