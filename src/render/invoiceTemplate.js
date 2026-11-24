// Module exports shared by the invoice family templates (invoice, debit note, receipt): computed fields and the PDF,
// HTML and Markdown renditions of the invoice frame. Each template's index.js re-exports these; its template.json
// params make it an invoice, a debit note or a receipt.
import { drawInvoiceFrame, invoiceModel, invoiceTotals, parseRowHeight } from './pdf/invoiceFrame.js';
import { invoiceToHtml } from './html/invoiceFrame.js';
import { invoiceBlocks } from './md/invoiceFrame.js';

/** The brand tax mode named by `values.taxMode` (null when the template is not taxable or no mode is chosen). */
function taxMode(values, env) {
  if (env.params?.taxable === false || !values.taxMode) return null;
  const mode = env.brand.tax?.modes?.find((m) => m.id === values.taxMode);
  if (!mode) throw new Error(`unknown tax mode "${values.taxMode}"`);
  return mode;
}

/** Computed fields of the invoice family. */
export const computed = Object.freeze({
  /** Subtotal, tax lines and total in minor units (see invoiceTotals). */
  totals: (values, env) => invoiceTotals(values.items ?? [], taxMode(values, env)),
  /** The document amount (minor units): the generator stores it as the document's amount. */
  total: (values) => values.totals?.total,
  /** The brand bank account: `bankAccount` names it by account number or 0-based index; default the first one. */
  bank: (values, env) => {
    const list = env.brand.bankAccounts ?? [];
    const want = values.bankAccount;
    if (want === undefined || want === null || want === '') return list[0];
    const hit = list.find((b) => b.accountNumber === String(want)) ?? (/^\d+$/.test(String(want)) && String(want).length < 4 ? list[Number(want)] : undefined);
    if (!hit) throw new Error(`brand "${env.brand.id}" has no bank account "${want}"`);
    return hit;
  },
  /** Layout choices checked up front: `rowHeight` (a number of points or "auto", default `params.rowHeight`). */
  layout: (values, env) => ({ rowHeight: parseRowHeight(values.rowHeight ?? env.params?.rowHeight) }),
});

const model = (values, env) => invoiceModel({ ...values, rowHeight: values.layout?.rowHeight ?? values.rowHeight }, env);

/**
 * PDF rendition: the invoice frame on one page (more only when the items do not fit).
 * @param {import('./pdf/document.js').PdfContext} pctx @param {object} values @param {object} env
 */
export async function renderPdf(pctx, values, env) {
  await drawInvoiceFrame(pctx, model(values, env), env.params?.frame);
}

/**
 * HTML rendition (standalone: fonts and images embedded).
 * @param {object} values @param {object} env
 */
export function renderHtml(values, env) {
  const m = model(values, env);
  const title = [env.meta?.title, m.number.value].filter(Boolean).join(' ');
  return invoiceToHtml(m, { brand: env.brand, ws: env.ctx?.ws, title, frame: env.params?.frame, standalone: true });
}

/**
 * Blocks for the Markdown rendition (PDF and HTML use renderPdf / renderHtml).
 * @param {object} values @param {object} env
 */
export function blocks(values, env) {
  return invoiceBlocks(model(values, env));
}
