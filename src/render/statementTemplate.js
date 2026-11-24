// Shared module code of the statement templates: employee final settlement, ticketing & settlement statement, client
// final settlement, remittance statement and expense statement (docs/DISCOVERY.md A8 §6-8, §10). Each template's
// index.js re-exports one of the module objects below. All amounts are integer minor units (paise); percentages are
// applied with integer arithmetic and rounded half up (see percentOf). Every printed string comes from the template
// params (neutral defaults in template.json, overridable per brand with `templateParams`), the brand or the values.
import { interpolate } from '../workspace/index.js';
import { getProfile } from './pdf/profiles.js';
import { letterMoney, letterScope, referenceNumber, textLines } from './letterTemplate.js';
import {
  drawClientSettlement, drawEmployeeSettlement, drawExpenseStatement, drawRemittance, drawTicketingStatement,
} from './pdf/statementFrames.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v) => !(v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));

// ---------------------------------------------------------------- integer money arithmetic

function checkMinor(v, name) {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${name} must be a non-negative amount`);
  return v;
}

/**
 * `a / b` rounded half up, for non-negative integers (BigInt inside, so large amounts stay exact).
 * @param {number} a @param {number} b
 * @returns {number}
 */
export function divHalfUp(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b <= 0) throw new RangeError('divHalfUp: non-negative integers expected');
  return Number(divBig(BigInt(a), BigInt(b)));
}

/**
 * Check a percentage (a finite number from 0 to 100 with at most 4 decimals) and return it in units of 0.0001 %.
 * @param {unknown} percent @param {string} name
 */
export function percentUnits(percent, name = 'percent') {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`${name} must be a number from 0 to 100`);
  }
  const units = Math.round(percent * 10000);
  if (Math.abs(units - percent * 10000) > 1e-6) throw new Error(`${name} may have at most 4 decimals`);
  return units;
}

/**
 * `percent`% of an amount in minor units, rounded half up to a whole minor unit: the legacy ticketing maths
 * (`Math.round(gross_paise * 0.015)`, then GST `Math.round(fee_paise * 0.18)`) done in exact integers, so a result that
 * is exactly half a paisa always rounds up (floating point could land just below the half).
 * @param {number} minor @param {number} percent e.g. 1.5 or 18
 * @returns {number}
 */
export function percentOf(minor, percent) {
  checkMinor(minor, 'amount');
  return Number(divBig(BigInt(minor) * BigInt(percentUnits(percent)), 1000000n));
}

function divBig(A, B) {
  const q = A / B;
  return (A % B) * 2n >= B ? q + 1n : q;
}

/** Hundredths of a day count (days may be fractional, e.g. 1.5). */
function dayHundredths(days, name) {
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) throw new Error(`${name} must be a non-negative number`);
  const h = Math.round(days * 100);
  if (Math.abs(h - days * 100) > 1e-6) throw new Error(`${name} may have at most 2 decimals`);
  return h;
}

const plain = (n) => String(Number.isInteger(n) ? n : Number(n.toFixed(2)));

/** List items that must be plain objects. */
function list(v, name) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`${name} must be a list`);
  v.forEach((x, i) => { if (!isPlainObject(x)) throw new Error(`${name}.${i} must be an object`); });
  return v;
}

const label = (x, name) => {
  if (typeof x.label !== 'string' || !x.label.trim()) throw new Error(`${name}.label is required`);
  return x.label.trim();
};

// ---------------------------------------------------------------- computations (computed fields)

/**
 * Employee final settlement figures: per-day salary = monthly / working days, half-day = per-day / 2 (each rounded
 * half up to a paisa); each attendance deduction = days × the per-day or half-day rate; other deductions and additions
 * as given; net = monthly + additions - deductions.
 * @param {{ monthlySalary: number, workingDays: number, attendance?: object[], deductions?: object[], additions?: object[] }} values
 */
export function employeeSettlement(values) {
  const monthly = checkMinor(values.monthlySalary, 'monthlySalary');
  const workingDays = values.workingDays;
  if (!Number.isSafeInteger(workingDays) || workingDays <= 0) throw new Error('workingDays must be a whole number above 0');
  const perDay = divHalfUp(monthly, workingDays);
  const halfDay = divHalfUp(perDay, 2);
  const attendance = list(values.attendance, 'attendance').map((a, i) => {
    const rule = a.rule ?? 'full';
    if (!['full', 'half'].includes(rule)) throw new Error(`attendance.${i}.rule must be "full" or "half"`);
    const days = dayHundredths(a.days, `attendance.${i}.days`);
    const rate = rule === 'half' ? halfDay : perDay;
    return { label: label(a, `attendance.${i}`), days: days / 100, rule, rate, amount: divHalfUp(days * rate, 100) };
  });
  const money = (key) => list(values[key], key).map((x, i) => ({ label: label(x, `${key}.${i}`), amount: checkMinor(x.amount, `${key}.${i}.amount`) }));
  const deductions = money('deductions');
  const additions = money('additions');
  const totalDeductions = [...attendance, ...deductions].reduce((s, x) => s + x.amount, 0);
  const totalAdditions = additions.reduce((s, x) => s + x.amount, 0);
  const net = monthly + totalAdditions - totalDeductions;
  if (net < 0) throw new Error('the deductions are larger than the salary and additions; the net would be negative');
  return { monthly, workingDays, perDay, halfDay, attendance, deductions, additions, totalDeductions, totalAdditions, net };
}

/**
 * Ticketing figures: revenue per row = sold × price; gross = Σ revenue; platform fee = feePercent of gross and GST =
 * gstPercent of the fee (each rounded half up to a paisa, as the legacy paise maths); charges = fee + GST; net = gross -
 * charges when `deductCharges`, else gross (charges shown for reference).
 * @param {{ tickets: object[], feePercent?: number, gstPercent?: number, deductCharges?: boolean }} values
 */
export function ticketingSettlement(values) {
  const rows = list(values.tickets, 'tickets').map((t, i) => {
    const sold = t.sold;
    if (!Number.isSafeInteger(sold) || sold < 0) throw new Error(`tickets.${i}.sold must be a whole number`);
    const price = checkMinor(t.price, `tickets.${i}.price`);
    const type = String(t.type ?? '').trim();
    const event = String(t.event ?? '').trim();
    if (!type && !event) throw new Error(`tickets.${i} needs a type or an event`);
    return { event, type, sold, price, revenue: sold * price };
  });
  if (!rows.length) throw new Error('tickets must list at least one ticket type');
  const gross = rows.reduce((s, r) => s + r.revenue, 0);
  if (!Number.isSafeInteger(gross)) throw new Error('ticket revenue is too large');
  const feePercent = values.feePercent ?? 0;
  const gstPercent = values.gstPercent ?? 18;
  const fee = percentOf(gross, feePercent);
  const gst = percentOf(fee, gstPercent);
  const charges = fee + gst;
  const deductCharges = values.deductCharges !== false;
  if (deductCharges && charges > gross) throw new Error('the platform charges are larger than the ticket revenue; the net would be negative');
  return { rows, sold: rows.reduce((s, r) => s + r.sold, 0), gross, feePercent, gstPercent, fee, gst, charges, deductCharges, net: deductCharges ? gross - charges : gross };
}

/**
 * Client final settlement figures: GST = gstPercent of the service fee (half up); service total = fee + GST; balance
 * = service total - advance; expenses total = Σ expenses; total payable = balance + expenses total.
 * @param {{ serviceFee?: number, gstPercent?: number, advance?: number, expenses?: object[] }} values
 */
export function clientSettlement(values) {
  const fee = checkMinor(values.serviceFee ?? 0, 'serviceFee');
  const gstPercent = values.gstPercent ?? 18;
  const gst = percentOf(fee, gstPercent);
  const serviceTotal = fee + gst;
  const advance = checkMinor(values.advance ?? 0, 'advance');
  const balance = serviceTotal - advance;
  const expenses = list(values.expenses, 'expenses').map((x, i) => {
    const description = String(x.description ?? '').trim();
    if (!description) throw new Error(`expenses.${i}.description is required`);
    return { description, amount: checkMinor(x.amount, `expenses.${i}.amount`) };
  });
  const expensesTotal = expenses.reduce((s, x) => s + x.amount, 0);
  const total = balance + expensesTotal;
  if (total < 0) throw new Error('the advance is larger than everything payable; the total would be negative');
  return { fee, gstPercent, gst, serviceTotal, advance, balance, expenses, expensesTotal, total };
}

/**
 * Expense statement lines and total.
 * @param {{ items: object[] }} values
 */
export function expenseTotals(values) {
  const items = list(values.items, 'items').map((x, i) => {
    const particulars = String(x.particulars ?? '').trim();
    if (!particulars) throw new Error(`items.${i}.particulars is required`);
    return { particulars, calculation: String(x.calculation ?? '').trim(), amount: checkMinor(x.amount, `items.${i}.amount`) };
  });
  if (!items.length) throw new Error('items must list at least one expense');
  return { items, total: items.reduce((s, x) => s + x.amount, 0) };
}

/** Key/value rows given as `[{ label, value }]` or `[[label, value]]` (bank or account details). */
export function detailRows(v, name) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`${name} must be a list of { label, value }`);
  return v.map((r, i) => {
    const [l, val] = Array.isArray(r) ? r : isPlainObject(r) ? [r.label, r.value] : [];
    if (typeof l !== 'string' || !l.trim() || val === undefined || val === null || String(val).trim() === '') {
      throw new Error(`${name}.${i} must be { label, value }`);
    }
    return [l.trim(), String(val).trim()];
  });
}

/** The brand bank account named by `bankAccount` (account number or index; default the first), as label/value rows. */
function brandBankRows(values, env) {
  const accounts = env.brand.bankAccounts ?? [];
  const want = values.bankAccount;
  let acc;
  if (!present(want)) acc = accounts[0];
  else {
    acc = accounts.find((b) => b.accountNumber === String(want).trim()) ?? (/^\d{1,3}$/.test(String(want)) ? accounts[Number(want)] : undefined);
    if (!acc) throw new Error(`brand "${env.brand.id}" has no bank account "${want}"`);
  }
  if (!acc) return [];
  const labels = env.params?.bankLabels ?? {};
  return (env.params?.bankFields ?? ['accountName', 'bankName', 'accountNumber', 'ifsc', 'branch'])
    .filter((k) => present(acc[k])).map((k) => [labels[k] ?? k, String(acc[k])]);
}

/** Bank rows of the expense statement: the `bankDetails` field, else the brand account chosen by `bankAccount`. */
function bankRows(values, env) {
  return present(values.bankDetails) ? detailRows(values.bankDetails, 'bankDetails') : brandBankRows(values, env);
}

// ---------------------------------------------------------------- shared helpers

/** Interpolation scope of a statement: letterScope plus `{companyUpper}`, `{number}` and `extra`. */
function scopeOf(values, env, extra = {}) {
  const ref = referenceNumber(values, env);
  return letterScope(values, env, { companyUpper: String(env.brand.legalName).toUpperCase(), number: ref, ...extra });
}

const filler = (scope) => (t) => interpolate(String(t ?? ''), scope).trim();

/** Meta cells `{ label, value }` with interpolated text; cells whose value is empty are left out. */
function metaCells(cells, fill) {
  return (cells ?? []).map((c) => (c ? { label: fill(c.label), value: fill(c.value) } : null)).filter((c) => c && c.value);
}

/** Paragraph items (text or `{ text, when?, unless? }`) that apply to the values, interpolated. */
function texts(items, values, fill) {
  const holds = (paths) => (paths === undefined ? [] : Array.isArray(paths) ? paths : [paths]);
  const get = (p) => String(p).split('.').reduce((v, k) => (v != null && typeof v === 'object' ? v[k] : undefined), values);
  return (items ?? []).map((it) => (typeof it === 'string' ? { text: it } : it))
    .filter((it) => isPlainObject(it) && holds(it.when).every((p) => present(get(p)) && get(p) !== false)
      && !holds(it.unless).some((p) => present(get(p)) && get(p) !== false))
    .map((it) => fill(it.text)).filter(Boolean);
}

const stripColon = (s) => String(s).replace(/:\s*$/, '');
const kv = (cells) => ({ type: 'keyValue', rows: cells.map((c) => [stripColon(c.label), c.value]) });

const footerOf = (env, base = {}) => ({ ...base, ...env.params?.footer });

// ---------------------------------------------------------------- employee final settlement

/**
 * Model of the employee final settlement (A8 §6b): title, meta grid, salary / deductions / calculation tables, net
 * box, optional declaration, signature row (authorised signatory, date, employee).
 * @param {object} values @param {object} env
 */
export function employeeSettlementModel(values, env) {
  const p = env.params ?? {};
  const { fmt } = env;
  const s = values.settlement ?? employeeSettlement(values);
  const whole = (m) => letterMoney(fmt, m);
  const fixed = (m) => fmt.money(m);
  const units = { one: 'day', other: 'days', ...p.dayUnits };
  const daysText = (n) => `${plain(n)} ${n === 1 ? units.one : units.other}`;
  const base = scopeOf(values, env, {
    employeeName: String(values.employeeName ?? ''),
    workingDays: plain(s.workingDays), workingDaysText: daysText(s.workingDays),
    monthly: whole(s.monthly), monthlyFixed: fixed(s.monthly), perDay: whole(s.perDay), halfDay: whole(s.halfDay),
    deductions: whole(s.totalDeductions), deductionsFixed: fixed(s.totalDeductions), additions: whole(s.totalAdditions),
    net: fixed(s.net), netWords: fmt.amountInWords(Math.abs(s.net)),
  });
  const period = present(values.period) ? String(values.period).trim() : filler(base)(p.periodText ?? '{periodStart} to {periodEnd}');
  const scope = { ...base, period };
  const fill = filler(scope);
  const rowFill = (t, extra) => filler({ ...scope, ...extra })(t);

  const st = p.salaryTable ?? {};
  const salaryRows = [
    { label: fill(st.monthly), value: whole(s.monthly), valBold: true },
    { label: fill(st.workingDays), value: daysText(s.workingDays) },
    { label: fill(st.perDay), value: whole(s.perDay) },
  ];
  if (p.showHalfDay !== false) salaryRows.push({ label: fill(st.halfDay), value: whole(s.halfDay) });

  const dt = p.deductionTable ?? {};
  const ruleNames = { half: 'half-day', full: 'full-day', ...p.ruleNames };
  const dedRows = [
    ...s.attendance.map((a) => ({
      label: rowFill(dt.attendance, { label: a.label, days: plain(a.days), daysText: daysText(a.days), rule: ruleNames[a.rule], rate: whole(a.rate) }),
      value: fixed(a.amount),
    })),
    ...s.deductions.map((x) => ({ label: rowFill(dt.other ?? '{label}', { label: x.label }), value: fixed(x.amount) })),
    { label: fill(dt.total), value: fixed(s.totalDeductions), bold: true, bullet: false },
  ];

  const ct = p.calculationTable ?? {};
  const calcRows = [
    { label: fill(ct.gross), value: fixed(s.monthly) },
    ...s.additions.map((x) => ({ label: rowFill(ct.addition ?? 'Add: {label}', { label: x.label }), value: fixed(x.amount) })),
    { label: fill(ct.deductions), value: fill(ct.deductionsValue ?? '– {deductionsFixed}') },
  ];

  const decl = values.declaration ?? p.declaration;
  return {
    title: fill(p.title),
    columns: (p.columnLabels ?? ['Particulars', 'Amount']).map(fill),
    meta: (p.meta ?? []).map((row) => row.map((c) => {
      if (!c) return null;
      const value = fill(c.value);
      return value ? { label: fill(c.label), value } : null;
    })),
    tables: [
      { title: fill(st.title), rows: salaryRows },
      { title: fill(dt.title), rows: dedRows },
      { title: fill(ct.title), rows: calcRows },
    ],
    net: { label: fill(p.net?.label), note: fill(p.net?.note), amount: fixed(s.net), words: scope.netWords },
    declaration: decl ? { title: fill(isPlainObject(decl) ? decl.title : ''), text: fill(isPlainObject(decl) ? decl.text : decl) } : null,
    signRow: {
      labels: (p.signatureRow ?? ['', '', '']).map(fill), date: fmt.date(values.date, 'long'),
      signatoryId: values.signatory?.id ?? null, variant: p.signatureVariant,
    },
  };
}

function employeeBlocks(values, env) {
  const m = employeeSettlementModel(values, env);
  const out = [{ type: 'heading', level: 1, text: m.title }];
  out.push(kv(m.meta.flat().filter(Boolean)));
  for (const t of m.tables) {
    out.push({ type: 'heading', level: 2, text: t.title });
    const rows = t.rows.filter((r) => !r.bold).map((r) => [r.label, r.value]);
    const totalRows = t.rows.filter((r) => r.bold).map((r) => [r.label, r.value]);
    out.push({ type: 'table', columns: [m.columns[0], { label: m.columns[1], align: 'right' }], rows, totalRows });
  }
  out.push({ type: 'paragraph', text: `**${m.net.label}:** **${m.net.amount}**`, align: 'left' });
  if (m.net.note) out.push({ type: 'paragraph', text: m.net.note });
  if (m.declaration?.text) {
    if (m.declaration.title) out.push({ type: 'heading', level: 3, text: m.declaration.title });
    out.push({ type: 'paragraph', text: m.declaration.text });
  }
  out.push({ type: 'keyValue', rows: [[m.signRow.labels[1] || 'Date', m.signRow.date]] });
  if (m.signRow.signatoryId) out.push({ type: 'signature', signatoryId: m.signRow.signatoryId, party: interpolate(env.params?.forLine ?? 'For {legalName}', scopeOf(values, env)), lines: [m.signRow.labels[0]].filter(Boolean) });
  out.push({ type: 'signature', party: m.signRow.labels[2] || 'Employee', lines: [] });
  return out;
}

/** Module exports of `employee-final-settlement`. */
export const employeeSettlementModule = Object.freeze({
  computed: Object.freeze({
    settlement: (values) => employeeSettlement(values),
    total: (values) => values.settlement?.net,
  }),
  blocks: employeeBlocks,
  async renderPdf(pctx, values, env) {
    await drawEmployeeSettlement(pctx, employeeSettlementModel(values, env), { contact: env.meta.contact, frame: env.params?.frame, footer: footerOf(env) });
  },
});

// ---------------------------------------------------------------- ticketing & settlement statement

/**
 * Model of the ticketing & settlement statement (A8 §7): meta block (repeated on every page), ticket table (with an
 * event column when any ticket names one), platform charges card, final settlement box, acknowledgement.
 * @param {object} values @param {object} env
 */
export function ticketingModel(values, env) {
  const p = env.params ?? {};
  const { fmt } = env;
  const s = values.settlement ?? ticketingSettlement(values);
  const money = (m) => fmt.money(m);
  const scope = scopeOf(values, env, {
    issuedTo: textLines(values.issuedTo).join('\n'),
    feePercent: plain(s.feePercent), gstPercent: plain(s.gstPercent),
    gross: money(s.gross), fee: money(s.fee), gst: money(s.gst), charges: money(s.charges), net: money(s.net), netWords: fmt.amountInWords(s.net),
  });
  const fill = filler(scope);
  const withEvent = s.rows.some((r) => r.event);
  const columns = (withEvent ? p.eventColumns : p.columns) ?? [];
  let group = -1;
  const rows = s.rows.map((r) => {
    if (!withEvent || r.event) group++;
    return { group, cells: { event: r.event, type: r.type, sold: String(r.sold), price: money(r.price), revenue: money(r.revenue) } };
  });
  const firstKey = columns[0]?.key;
  const totalRow = { sold: String(s.sold), revenue: money(s.gross) };
  if (firstKey) totalRow[firstKey] = fill(p.totalLabel ?? 'Total');
  const c = p.charges ?? {};
  const a = p.acknowledgement ?? {};
  const ackText = values.acknowledgementText ?? a.text;
  return {
    title: fill(p.title),
    metaLeft: metaCells(p.metaLeft, fill),
    // `{page}` / `{pages}` stay as placeholders here; the PDF post-pass fills them per page.
    metaRight: (p.metaRight ?? []).map((r) => ({ label: fill(r.label), value: interpolate(String(r.value ?? ''), { ...scope, page: '{page}', pages: '{pages}' }).trim() }))
      .filter((r) => r.value),
    sections: Object.fromEntries(Object.entries(p.sections ?? {}).map(([k, v]) => [k, fill(v)])),
    columns: columns.map((col) => ({ ...col, label: fill(col.label) })),
    rows,
    totalRow,
    charges: p.showCharges === false ? null : {
      title: fill(c.title), lines: [[fill(c.base), money(s.fee)], [fill(c.gst), money(s.gst)]], total: [fill(c.total), money(s.charges)],
    },
    final: { label: fill(p.finalLabel), amount: money(s.net), words: scope.netWords },
    acknowledgement: ackText ? {
      text: fill(ackText), fields: (a.fields ?? []).map(fill), spacing: a.fieldSpacing ?? 42, breakMin: a.breakMin ?? 190,
    } : null,
  };
}

function ticketingBlocks(values, env) {
  const m = ticketingModel(values, env);
  const out = [{ type: 'heading', level: 1, text: m.title }];
  out.push(kv([...m.metaLeft, ...m.metaRight.filter((r) => !r.value.includes('{page'))]));
  out.push({ type: 'heading', level: 2, text: m.sections.sales });
  out.push({
    type: 'table', columns: m.columns.map((c) => ({ key: c.key, label: c.label, align: c.align ?? 'left' })),
    rows: m.rows.map((r) => r.cells), totalRows: [m.totalRow],
  });
  if (m.charges) {
    out.push({ type: 'heading', level: 2, text: m.sections.charges }, { type: 'heading', level: 3, text: m.charges.title });
    out.push({ type: 'table', columns: ['', { label: '', align: 'right' }], rows: m.charges.lines, totalRows: [m.charges.total] });
  }
  out.push({ type: 'heading', level: 2, text: m.sections.settlement });
  out.push({ type: 'paragraph', text: `**${m.final.label}** **${m.final.amount}**` });
  if (m.acknowledgement) {
    out.push({ type: 'heading', level: 2, text: m.sections.acknowledgement }, { type: 'paragraph', text: m.acknowledgement.text });
    out.push({ type: 'keyValue', rows: m.acknowledgement.fields.map((f) => [stripColon(f), '']) });
  }
  return out;
}

/** Module exports of `ticketing-settlement-statement`. */
export const ticketingModule = Object.freeze({
  computed: Object.freeze({
    settlement: (values) => ticketingSettlement(values),
    total: (values) => values.settlement?.net,
  }),
  blocks: ticketingBlocks,
  async renderPdf(pctx, values, env) {
    await drawTicketingStatement(pctx, ticketingModel(values, env), { contact: env.meta.contact, frame: env.params?.frame, footer: footerOf(env) });
  },
});

// ---------------------------------------------------------------- client final settlement

/**
 * Model of the client final settlement (A8 §7b): title and meta on page 1 (document number from the `settlement`
 * series), event details, professional fee with GST and advance, reimbursable expenses, summary, total box with the
 * amount in words, settlement note, footnote on the last page.
 * @param {object} values @param {object} env
 */
export function clientSettlementModel(values, env) {
  const p = env.params ?? {};
  const { fmt } = env;
  const s = values.settlement ?? clientSettlement(values);
  const num = (m) => fmt.number(m);
  const scope = scopeOf(values, env, {
    issuedTo: textLines(values.issuedTo).join('\n'), gstPercent: plain(s.gstPercent),
    fee: fmt.money(s.fee), gst: fmt.money(s.gst), advance: fmt.money(s.advance), balance: fmt.money(s.balance),
    expensesTotal: fmt.money(s.expensesTotal), total: fmt.money(s.total), totalWords: fmt.amountInWords(s.total),
  });
  const fill = filler(scope);
  const tw = env.params?.frame?.table ?? {};
  const { CW } = getProfile(env.meta.layoutProfile, env.brand.layoutProfiles);
  const labelW = tw.detailsLabelW ?? 140;
  const amountW = tw.amountW ?? 120;
  const strong = tw.strong ?? '#e2e8f0';
  const L = p.labels ?? {};
  const amountCols = [{ label: fill(L.particulars), width: CW - amountW }, { label: fill(L.amount), width: amountW, align: 'right' }];

  const details = present(values.details) ? detailRows(values.details, 'details') : (p.detailRows ?? [])
    .map((r) => [fill(r.label), fill(r.value)]).filter(([, v]) => v);

  const feeRows = [
    { cells: [fill(L.fee), num(s.fee)] },
    { cells: [fill(L.gst), num(s.gst)] },
    { cells: [fill(L.serviceTotal), num(s.serviceTotal)], bold: true, bg: strong },
  ];
  if (s.advance) {
    feeRows.push({ cells: [fill(L.advance), `(${num(s.advance)})`], bold: true, bg: '#ffffff' });
    feeRows.push({ cells: [fill(L.balance), num(s.balance)], bold: true, bg: strong });
  }
  const sections = [
    { title: fill(p.sections?.details), columns: [{ label: fill(L.particular), width: labelW }, { label: fill(L.details), width: CW - labelW }],
      rows: details.map(([k, v]) => ({ cells: [k, v], bold: [true, false] })), after: tw.afterDetails ?? 35 },
    { title: fill(p.sections?.fees), columns: amountCols, rows: feeRows, after: tw.afterFees ?? 12 },
  ];
  if (s.expenses.length) {
    sections.push({
      title: fill(p.sections?.expenses), breakBefore: p.breakBeforeExpenses !== false, columns: amountCols, after: tw.afterExpenses ?? 18,
      rows: [...s.expenses.map((x) => ({ cells: [x.description, num(x.amount)] })), { cells: [fill(L.expensesTotal), num(s.expensesTotal)], bold: true, bg: strong }],
    });
  }
  sections.push({
    title: fill(p.sections?.summary), breakBefore: !s.expenses.length && p.breakBeforeExpenses !== false, columns: amountCols, after: tw.afterSummary ?? 18,
    rows: [
      { cells: [fill(L.summaryBalance), num(s.balance)] },
      ...(s.expenses.length ? [{ cells: [fill(L.expensesTotal), num(s.expensesTotal)] }] : []),
      { cells: [fill(L.totalPayable), num(s.total)], bold: true, bg: strong },
    ],
  });
  if (!details.length) sections.shift();
  return {
    title: fill(p.title),
    metaLeft: metaCells(p.metaLeft, fill),
    metaRight: metaCells(p.metaRight, fill),
    sections,
    total: { label: fill(p.totalLabel), amount: fmt.money(s.total), words: fill(p.totalWords ?? '({totalWords})') },
    note: texts(values.note ?? p.note, values, fill).join('\n\n'),
    footnote: texts(values.footnote ?? p.footnote, values, fill).join(' '),
  };
}

function clientSettlementBlocks(values, env) {
  const m = clientSettlementModel(values, env);
  const out = [{ type: 'heading', level: 1, text: m.title }, kv([...m.metaLeft, ...m.metaRight])];
  for (const s of m.sections) {
    out.push({ type: 'heading', level: 2, text: s.title });
    const cols = s.columns.map((c) => ({ label: c.label, align: c.align ?? 'left' }));
    const isTotal = (r) => r.bold === true;
    out.push({ type: 'table', columns: cols, rows: s.rows.filter((r) => !isTotal(r)).map((r) => r.cells), totalRows: s.rows.filter(isTotal).map((r) => r.cells) });
  }
  out.push({ type: 'paragraph', text: `**${m.total.label}** **${m.total.amount}**` });
  if (m.total.words) out.push({ type: 'paragraph', text: m.total.words });
  for (const para of m.note.split('\n\n').filter(Boolean)) out.push({ type: 'paragraph', text: para });
  if (m.footnote) out.push({ type: 'divider' }, { type: 'paragraph', text: m.footnote });
  return out;
}

/** Module exports of `client-final-settlement`. */
export const clientSettlementModule = Object.freeze({
  computed: Object.freeze({
    settlement: (values) => clientSettlement(values),
    total: (values) => values.settlement?.total,
  }),
  blocks: clientSettlementBlocks,
  async renderPdf(pctx, values, env) {
    await drawClientSettlement(pctx, clientSettlementModel(values, env), { contact: env.meta.contact, frame: env.params?.frame, footer: footerOf(env) });
  },
});

// ---------------------------------------------------------------- remittance statement

/**
 * Model of the remittance statement (A8 §8): date line (with `Ref:` when numbered), salutation, subject, the
 * confirmation paragraph, transaction details, the receiving account (from the `account` field), closing paragraph and
 * the signature with the optional seal.
 * @param {object} values @param {object} env
 */
export function remittanceModel(values, env) {
  const p = env.params ?? {};
  const { fmt } = env;
  const amount = `${letterMoney(fmt, values.amount)}${p.amountSuffix ?? ''}`;
  const scope = scopeOf(values, env, {
    amount, amountWords: fmt.amountInWords(values.amount), recipient: String(values.recipient ?? ''),
    transferDate: fmt.date(values.transferDate ?? values.date, 'long'),
  });
  const fill = filler(scope);
  const ref = referenceNumber(values, env);
  const details = (p.detailRows ?? []).map((r) => [fill(r.label), fill(r.value)]).filter(([, v]) => v);
  const account = values.accountRows ?? detailRows(values.account, 'account');
  const lists = [];
  if (details.length) lists.push({ intro: fill(p.detailsIntro), rows: details });
  if (account.length) lists.push({ title: fill(p.accountTitle), rows: account });
  return {
    ref: ref ? fill(p.refLabel ?? 'Ref: {number}') : '',
    date: fill(p.dateLabel ?? 'Date: {date}'),
    salutation: fill(p.salutation),
    subject: fill(values.subject ?? p.subject),
    intro: texts(values.paragraphs ?? p.paragraphs, values, fill).join(' '),
    lists,
    closing: texts(values.closing ?? p.closing, values, fill).join(' '),
    signature: { signatoryId: values.signatory.id, forLine: fill(p.signature?.forLine ?? 'For {legalName}'), seal: values.seal === true },
  };
}

function remittanceBlocks(values, env) {
  const m = remittanceModel(values, env);
  const out = [];
  out.push({ type: 'paragraph', text: [m.ref, m.date].filter(Boolean).map((x) => `**${x}**`).join('  \n'), align: 'left' });
  out.push({ type: 'paragraph', text: `**${m.salutation}**`, align: 'left' }, { type: 'paragraph', text: `**${m.subject}**`, align: 'left' });
  out.push({ type: 'paragraph', text: m.intro });
  for (const l of m.lists) {
    if (l.title) out.push({ type: 'paragraph', text: `**${l.title}**`, align: 'left' });
    if (l.intro) out.push({ type: 'paragraph', text: l.intro, align: 'left' });
    out.push({ type: 'keyValue', rows: l.rows });
  }
  if (m.closing) out.push({ type: 'paragraph', text: m.closing });
  const sig = { type: 'signature', signatoryId: m.signature.signatoryId, party: m.signature.forLine };
  if (!m.signature.seal) sig.style = { block: { seal: null } };
  out.push(sig);
  return out;
}

/** Module exports of `remittance-statement`. */
export const remittanceModule = Object.freeze({
  computed: Object.freeze({
    total: (values) => checkMinor(values.amount, 'amount'),
    accountRows: (values) => detailRows(values.account, 'account'),
  }),
  blocks: remittanceBlocks,
  async renderPdf(pctx, values, env) {
    await drawRemittance(pctx, remittanceModel(values, env), {
      contact: env.meta.contact, frame: env.params?.frame, footer: footerOf(env, { centerStyle: 'caps' }),
    });
  },
});

// ---------------------------------------------------------------- expense statement

/**
 * Model of the expense statement (A8 §10): title, date, addressee, subject, salutation, opening paragraphs, the expense
 * table with its total, the amount in words, closing paragraphs, the brand bank account and the sign-off.
 * @param {object} values @param {object} env
 */
export function expenseModel(values, env) {
  const p = env.params ?? {};
  const { fmt } = env;
  const s = values.totals ?? expenseTotals(values);
  const whole = (m) => letterMoney(fmt, m, { symbol: false });
  const scope = scopeOf(values, env, {
    recipient: textLines(values.recipient).join('\n'), total: letterMoney(fmt, s.total), totalWords: fmt.amountInWords(s.total),
  });
  const fill = filler(scope);
  const t = p.table ?? {};
  const ref = referenceNumber(values, env);
  const bank = values.bank ?? bankRows(values, env);
  const signatory = env.brand.signatories.find((x) => x.id === values.signatory.id);
  const so = p.signOff ?? {};
  return {
    title: fill(p.title),
    ref: ref ? fill(p.refLabel ?? 'Ref: {number}') : '',
    dateLabel: fill(p.dateLabel ?? 'Date:') + ' ',
    date: fmt.date(values.date, 'long'),
    toLabel: fill(p.toLabel ?? 'To'),
    recipient: scope.recipient,
    subject: fill(values.subject ?? p.subject),
    salutation: fill(p.salutation),
    opening: texts(values.opening ?? p.opening, values, fill),
    table: {
      columns: (t.columns ?? []).map((c) => ({ ...c, label: fill(c.label) })),
      rows: [
        ...s.items.map((x) => ({ cells: [x.particulars, x.calculation, whole(x.amount)] })),
        { cells: ['', fill(t.totalLabel), letterMoney(fmt, s.total)], total: true },
      ],
    },
    wordsLabel: fill(p.wordsLabel ?? 'Amount in Words'),
    words: fill(p.words ?? '{totalWords}.'),
    closingParagraphs: texts(values.closing ?? p.closing, values, fill),
    bankTitle: fill(p.bankTitle),
    bank: bank.length && p.showBank !== false ? { columns: (p.bankColumns ?? []).map((c) => ({ ...c, label: fill(c.label) })), rows: bank.map((r) => ({ cells: r })) } : null,
    signOff: {
      closing: fill(so.closing), yoursLine: fill(so.yours), forLine: fill(so.forLine ?? 'For {legalName}'),
      signatoryId: values.signatory.id, name: signatory?.name ?? '', title: signatory?.title ?? '',
      lines: (so.lines ?? []).map((l) => (typeof l === 'string' ? { text: fill(l) } : { text: fill(l.text), bold: Boolean(l.bold) })).filter((l) => l.text),
    },
  };
}

function expenseBlocks(values, env) {
  const m = expenseModel(values, env);
  const out = [{ type: 'heading', level: 1, text: m.title }];
  out.push({ type: 'paragraph', text: [m.ref, `${m.dateLabel}${m.date}`].filter(Boolean).join('  \n'), align: 'left' });
  out.push({ type: 'paragraph', text: `**${m.toLabel}**\n${m.recipient}`, align: 'left' });
  out.push({ type: 'paragraph', text: `**${m.subject}**`, align: 'left' }, { type: 'paragraph', text: m.salutation, align: 'left' });
  for (const t of m.opening) out.push({ type: 'paragraph', text: t, align: 'left' });
  const cols = m.table.columns.map((c) => ({ label: c.label, align: c.align ?? 'left' }));
  out.push({ type: 'table', columns: cols, rows: m.table.rows.filter((r) => !r.total).map((r) => r.cells), totalRows: m.table.rows.filter((r) => r.total).map((r) => r.cells) });
  out.push({ type: 'paragraph', text: `**${m.wordsLabel}:** ${m.words}`, align: 'left' });
  for (const t of m.closingParagraphs) out.push({ type: 'paragraph', text: t, align: 'left' });
  if (m.bank) {
    out.push({ type: 'heading', level: 2, text: m.bankTitle });
    out.push({ type: 'table', columns: m.bank.columns.map((c) => c.label), rows: m.bank.rows.map((r) => r.cells) });
  }
  if (m.signOff.closing) out.push({ type: 'paragraph', text: m.signOff.closing, align: 'left' });
  out.push({ type: 'paragraph', text: m.signOff.yoursLine, align: 'left' });
  out.push({ type: 'signature', signatoryId: m.signOff.signatoryId, party: m.signOff.forLine, lines: m.signOff.lines.map((l) => l.text), style: { block: { seal: null } } });
  return out;
}

/** Module exports of `expense-statement`. */
export const expenseModule = Object.freeze({
  computed: Object.freeze({
    totals: (values) => expenseTotals(values),
    total: (values) => values.totals?.total,
    bank: (values, env) => bankRows(values, env),
  }),
  blocks: expenseBlocks,
  async renderPdf(pctx, values, env) {
    await drawExpenseStatement(pctx, expenseModel(values, env), { contact: env.meta.contact, frame: env.params?.frame, footer: env.params?.footer });
  },
});
