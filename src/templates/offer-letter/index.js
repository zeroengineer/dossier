// Offer letter (docs/DISCOVERY.md A8 §2): the offer-family letter with the salary annexure (earnings, deductions and
// summary tables built from the input rows; totals in minor units). Wording comes from template.json params.
import { interpolate } from '../../workspace/index.js';
import {
  LETTER_PDF_CUSTOM, OFFER_FOOTER, OFFER_STYLE, checkContent, letterRenderPdf, offerFamilyBlocks,
} from '../../render/letterTemplate.js';

export const style = OFFER_STYLE;
export const pdfCustom = LETTER_PDF_CUSTOM;

/**
 * Salary rows in minor units: `{ rows: [{ label, monthly, annual }], monthly, annual }`; `annual` defaults to
 * 12 × `monthly`.
 * @param {{ earnings?: Array<{ label?: string, monthly?: number, annual?: number }> }} values
 */
export function salary(values) {
  const rows = (values.earnings ?? []).map((e, i) => {
    if (!e || typeof e.label !== 'string' || !e.label.trim()) throw new Error(`earnings.${i}.label is required`);
    if (!Number.isInteger(e.monthly)) throw new Error(`earnings.${i}.monthly is required`);
    const annual = e.annual ?? e.monthly * 12;
    if (!Number.isInteger(annual)) throw new Error(`earnings.${i}.annual must be an amount`);
    if (e.monthly < 0 || annual < 0) throw new Error(`earnings.${i}: salary amounts must not be negative`);
    return { label: e.label.trim(), monthly: e.monthly, annual };
  });
  let monthly = 0;
  let annual = 0;
  for (const r of rows) {
    monthly += r.monthly;
    annual += r.annual;
  }
  return { rows, monthly, annual };
}

export const computed = { salary, content: checkContent };

/** 0 when every salary amount is whole (legacy letters print `1,20,000`), else 2 for every amount of the letter. */
const salaryDecimals = (s) => ([...s.rows.flatMap((r) => [r.monthly, r.annual]), s.monthly, s.annual].every((m) => m % 100 === 0) ? 0 : 2);

const valueColumn = { align: 'right', font: 'BodyMedium', color: 'ink' };

/** The annexure page (A8 §2): heading, earnings table with the gross row, deductions, summary and notes. */
function annexure(values, env, scope) {
  const a = env.params.annexure ?? {};
  const fill = (t) => interpolate(t ?? '', scope);
  const s = values.salary;
  const num = (m) => env.fmt.number(m, { decimals: salaryDecimals(s) });
  const columns = (spec, keys) => keys.map((key, i) => ({
    key, label: fill(spec.columns?.[i]), ...(spec.widths?.[i] !== undefined ? { width: spec.widths[i] } : {}), ...(i ? valueColumn : {}),
  }));
  const e = a.earnings ?? {};
  const d = a.deductions ?? {};
  const sum = a.summary ?? {};
  const kv = (rows) => (rows ?? []).map((r) => ({ label: fill(r.label), value: fill(r.value) }));
  return [
    { type: 'heading', level: 1, text: fill(a.title), style: { before: 0.15, after: 0.5 } },
    { type: 'spacer', size: 12 },
    {
      type: 'table',
      columns: columns(e, ['label', 'monthly', 'annual']),
      rows: s.rows.map((r) => ({ label: r.label, monthly: num(r.monthly), annual: num(r.annual) })),
      totalRows: [{ label: fill(e.totalLabel), monthly: num(s.monthly), annual: num(s.annual) }],
    },
    { type: 'spacer', size: 24 },
    { type: 'heading', level: 2, text: fill(d.title), style: { before: 0.6, after: 0.4 } },
    { type: 'spacer', size: 10 },
    { type: 'table', columns: columns(d, ['label', 'value']), rows: values.deductions ?? kv(d.rows) },
    { type: 'spacer', size: 24 },
    { type: 'heading', level: 2, text: fill(sum.title), style: { before: 0.6, after: 0.4 } },
    { type: 'spacer', size: 10 },
    { type: 'table', columns: columns(sum, ['label', 'value']), rows: kv(sum.rows) },
    { type: 'spacer', size: 24 },
    ...(a.notes?.length ? [{ type: 'bullets', items: a.notes.map(fill), style: { itemMoveDown: 0.2, moveDown: 0.2 } }] : []),
  ];
}

/**
 * Blocks of the offer letter.
 * @param {object} values @param {object} env
 */
export function blocks(values, env) {
  const s = values.salary;
  const decimals = salaryDecimals(s);
  const extra = {
    ctcMonthly: env.fmt.money(s.monthly, { decimals }),
    ctcAnnual: env.fmt.money(s.annual, { decimals }),
    ctcMonthlyWords: env.fmt.amountInWords(s.monthly),
    ctcAnnualWords: env.fmt.amountInWords(s.annual),
  };
  return offerFamilyBlocks(values, env, { extra, annexure });
}

export const renderPdf = letterRenderPdf(blocks, { style, footer: OFFER_FOOTER });
