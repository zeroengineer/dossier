// Module code of the proposal and pricing-report templates (src/templates/proposal, src/templates/pricing-report):
// a cover, a contents page and data-driven sections drawn as the legacy gen-2 proposals and pricing reports
// (docs/DISCOVERY.md A8 §13-14, src/render/pdf/proposalFrame.js). Sections are data:
// `[{ title, blocks, subsections?: [{ title, blocks }] }]` from the `sections` field or `params.sections` (so a workspace
// replaces the default content with `brand.templateParams.<id>.sections` or its own template.json). Blocks are the
// shared block model (docs/TEMPLATES.md "Blocks") plus `custom` blocks `feeCard`, `priceCard`, `feeTable` (a fee
// calculator table, src/render/feeCalculator.js) and `signOff`. Every printed string comes from the params (neutral
// defaults in template.json), the brand or the values; `{placeholders}` in section text that have no value print as
// empty text and are reported as PLACEHOLDER_EMPTY warnings.
import { interpolate } from '../workspace/index.js';
import { coerceMoney } from '../services/fields.js';
import { mergeStyle, normaliseTable, validateBlocks } from './blocks.js';
import { escapeHtml } from './html/index.js';
import { FEE_METRICS, feeRates, ticketCharges } from './feeCalculator.js';
import { letterMoney, letterScope, referenceNumber, textLines } from './letterTemplate.js';
import { drawProposal, PROPOSAL_FRAME, REPORT_FRAME } from './pdf/proposalFrame.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v) => !(v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));
const plain = (n) => String(Number.isInteger(n) ? n : Number(n.toFixed(4)));
const UPPER = /^[A-Z][A-Z0-9_]*$/;

/** Custom block names a section may use. */
export const PROPOSAL_CUSTOM_BLOCKS = Object.freeze(['feeCard', 'priceCard', 'feeTable', 'signOff']);
const FEE_LAYOUTS = ['metrics', 'tiers', 'perBase'];

// ---------------------------------------------------------------- computed fields

/** `{CODE}` of the quotation number: the engagement's `attrs.code`, else the client's. */
function code(values) {
  const c = values.engagement?.attrs?.code ?? values.client?.attrs?.code;
  return present(c) ? String(c).trim() : undefined;
}

/** The fee rates of the document: `params.fees` with the `fees` field over it (validated). */
function rates(values, env) {
  return { ...feeRates(env.params.fees, values.fees) };
}

function checkFeeTable(data, params, at) {
  const def = params.feeTables?.[data.kind];
  if (!isPlainObject(def)) throw new Error(`${at}: feeTable kind "${data.kind}" is not defined in params.feeTables (known: ${Object.keys(params.feeTables ?? {}).join(', ')})`);
  const layout = def.layout ?? 'metrics';
  const where = `params.feeTables.${data.kind}`;
  if (!FEE_LAYOUTS.includes(layout)) throw new Error(`${at}: ${where}.layout must be one of ${FEE_LAYOUTS.join(', ')}`);
  const minColumns = layout === 'perBase' ? 1 : 2;
  if (!Array.isArray(def.columns) || def.columns.length < minColumns || !def.columns.every(isPlainObject)) {
    throw new Error(`${at}: ${where}.columns must be a list of at least ${minColumns} column objects ({ label, width?, align? })`);
  }
  if (layout !== 'perBase' && (!Array.isArray(def.rows) || def.rows.length === 0 || !def.rows.every(isPlainObject))) {
    throw new Error(`${at}: ${where}.rows must be a non-empty list of row objects ({ label, ${layout === 'tiers' ? 'value' : 'values'} })`);
  }
  if (layout === 'metrics') {
    def.rows.forEach((r, i) => {
      if (!Array.isArray(r.values) || r.values.length !== def.columns.length - 1) {
        throw new Error(`${at}: ${where}.rows.${i}.values must list one metric per value column (${def.columns.length - 1})`);
      }
    });
  }
  const metric = (m, where) => {
    if (!FEE_METRICS.includes(m)) throw new Error(`${at}: feeTables.${data.kind}${where}: unknown metric "${m}" (known: ${FEE_METRICS.join(', ')})`);
  };
  if (layout === 'perBase') def.columns.forEach((c, i) => metric(c.value, `.columns.${i}.value`));
  else {
    def.rows.forEach((r, i) => (layout === 'tiers' ? [r.value] : r.values ?? []).forEach((m) => metric(m, `.rows.${i}`)));
  }
  if (data.rates !== undefined) feeRates(data.rates);
  for (const b of [data.base, ...(Array.isArray(data.bases) ? data.bases : [])].filter((x) => x !== undefined)) {
    const r = coerceMoney(b);
    if (r.error || r.value < 0) throw new Error(`${at}: base price ${JSON.stringify(b)} is not a non-negative amount`);
  }
  if (data.bases !== undefined && (!Array.isArray(data.bases) || data.bases.length === 0)) throw new Error(`${at}: bases must be a non-empty list of amounts`);
}

function checkBlocks(blocks, at, values, params) {
  if (!Array.isArray(blocks)) throw new Error(`${at}.blocks must be a list of blocks`);
  try {
    validateBlocks(blocks);
  } catch (e) {
    throw new Error(`${at}.${e.message}`);
  }
  blocks.forEach((b, i) => {
    const where = `${at}.blocks[${i}]`;
    if (b.type === 'signature') throw new Error(`${where}: signature blocks are not used here (use { "type": "custom", "name": "signOff" })`);
    if (b.type === 'table' && b.boldRows !== undefined) {
      const n = b.rows.length;
      if (!(Array.isArray(b.boldRows) && b.boldRows.every((i) => Number.isInteger(i) && i >= 0 && i < n))) {
        throw new Error(`${where}: boldRows must be a list of row indices from 0 to ${n - 1}`);
      }
    }
    if (b.type !== 'custom') return;
    if (!PROPOSAL_CUSTOM_BLOCKS.includes(b.name)) throw new Error(`${where}: unknown custom block "${b.name}" (known: ${PROPOSAL_CUSTOM_BLOCKS.join(', ')})`);
    const data = b.data ?? {};
    if (!isPlainObject(data)) throw new Error(`${where}: data must be an object`);
    if (b.name === 'feeTable') checkFeeTable(data, params, where);
    if (b.name === 'priceCard') {
      if (data.amount !== undefined) {
        const r = coerceMoney(data.amount);
        if (r.error || r.value < 0) throw new Error(`${where}: amount ${JSON.stringify(data.amount)} is not a non-negative amount`);
      } else if (!Number.isSafeInteger(values.price)) {
        throw new Error(`${where}: a price card needs data.amount or the price field`);
      }
    }
    if (b.name === 'signOff' && !(values.signOff?.columns?.length > 0)) throw new Error(`${where}: a sign-off needs a signatory`);
  });
}

/**
 * The sections of the document (`sections` field, else `params.sections`), checked: `[{ title, blocks?, subsections?:
 * [{ title, blocks?, level?, breakMin?, divider?, toc? }], level?, newPage?, breakMin?, divider?, toc? }]`.
 * @param {Record<string, any>} values @param {{ params: object }} env
 */
function sections(values, env) {
  const list = values.sections ?? env.params.sections;
  if (!Array.isArray(list) || list.length === 0) throw new Error('sections must be a non-empty list of { title, blocks }');
  const num = (v, at) => {
    if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw new Error(`${at} must be a non-negative number`);
  };
  const checkPart = (s, at, sub) => {
    if (!isPlainObject(s)) throw new Error(`${at} must be an object`);
    if (!present(s.title)) throw new Error(`${at}.title is required`);
    if (s.level !== undefined && ![1, 2, 3].includes(s.level)) throw new Error(`${at}.level must be 1, 2 or 3`);
    num(s.breakMin, `${at}.breakMin`);
    checkBlocks(s.blocks ?? [], at, values, env.params);
    if (!sub && s.subsections !== undefined) {
      if (!Array.isArray(s.subsections)) throw new Error(`${at}.subsections must be a list`);
      s.subsections.forEach((x, j) => checkPart(x, `${at}.subsections[${j}]`, true));
    }
  };
  list.forEach((s, i) => checkPart(s, `sections[${i}]`, false));
  return structuredClone(list);
}

/**
 * Sign-off columns: the project contact (`projectContact`, a brand signatory id) when it differs from the authorised
 * signatory, then the signatory; rows from `params.signOff.rows` (`{name}`, `{title}`, `{email}`, `{phone}`).
 * @param {Record<string, any>} values @param {{ brand: object, params: object }} env
 */
function signOff(values, env) {
  const p = env.params.signOff ?? {};
  const people = [];
  if (present(values.projectContact)) {
    const id = String(values.projectContact).trim();
    const s = env.brand.signatories?.find((x) => x.id === id);
    if (!s) throw new Error(`brand "${env.brand.id}" has no signatory "${id}" (projectContact)`);
    if (s.id !== values.signatory?.id) people.push([p.contactHeading ?? '', s]);
  }
  if (values.signatory) people.push([p.signatoryHeading ?? '', values.signatory]);
  return {
    columns: people.map(([heading, s]) => ({
      heading: interpolate(heading, env.brand),
      rows: (p.rows ?? []).map((r) => [interpolate(r.label, s), interpolate(r.value, s)]),
    })),
  };
}

export const computed = Object.freeze({ code, rates, sections, signOff });

// ---------------------------------------------------------------- model

/**
 * Interpolate `{path}` placeholders, recording the names of those that print as empty text (upper-case tokens left
 * literal, as `interpolate` does).
 */
function filler(scope, warnings) {
  return (text, extra) => {
    const sc = extra ? { ...scope, ...extra } : scope;
    const s = String(text ?? '');
    if (warnings) {
      for (const [, path] of s.matchAll(/\{([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\}/g)) {
        if (UPPER.test(path)) continue;
        let v = sc;
        for (const part of path.split('.')) v = v != null && typeof v === 'object' ? v[part] : undefined;
        const printable = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
        if (!printable || String(v) === '') warnings.add(path);
      }
    }
    return interpolate(s, sc);
  };
}

function moneyOf(fmt, currency) {
  return (m) => (present(currency) ? `${currency}${fmt.number(m)}` : fmt.money(m));
}

/** A fee calculator table as a model table (`{ columns, rows, bold, total }`). */
function feeTable(data, values, env, fill) {
  const def = env.params.feeTables[data.kind];
  const r = feeRates(env.params.fees, values.fees, data.rates);
  const money = moneyOf(env.fmt, data.currency);
  const rateScope = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));
  const toMinor = (b) => coerceMoney(b).value;
  const bases = Array.isArray(data.bases) ? data.bases.map(toMinor)
    : data.base !== undefined ? [toMinor(data.base)] : [values.examplePrice ?? 0];
  const charges = bases.map((b) => ticketCharges(b, r));
  const label = (t, extra = {}) => fill(t, { ...rateScope, base: money(bases[0]), ...extra });
  const layout = def.layout ?? 'metrics';
  const flags = (rows) => ({
    bold: rows.flatMap((x, i) => (x.bold || x.total ? [i] : [])),
    total: rows.flatMap((x, i) => (x.total ? [i] : [])),
  });
  if (layout === 'perBase') {
    return {
      columns: def.columns.map((c) => ({ label: label(c.label), width: c.width, align: c.align ?? 'right' })),
      rows: charges.map((c) => def.columns.map((col) => money(c[col.value]))),
      bold: [], total: [],
    };
  }
  if (layout === 'tiers') {
    const [first, tier] = def.columns;
    const columns = [{ label: label(first.label), width: first.width, align: first.align ?? 'left' },
      ...bases.map((b, i) => ({ label: label(tier.label, { base: money(b) }), width: i < bases.length - 1 ? tier.width : undefined, align: tier.align ?? 'right' }))];
    return { columns, rows: def.rows.map((x) => [label(x.label), ...charges.map((c) => money(c[x.value]))]), ...flags(def.rows) };
  }
  const c = charges[0];
  return {
    columns: def.columns.map((col, i) => ({ label: label(col.label), width: col.width, align: col.align ?? (i === 0 ? 'left' : 'right') })),
    rows: def.rows.map((x) => [label(x.label), ...(x.values ?? []).map((m) => money(c[m]))]),
    ...flags(def.rows),
  };
}

/** A shared `table` block as a model table. */
function inputTable(b, fill) {
  const t = normaliseTable(b);
  const cells = (row) => t.columns.map((c) => fill(row[c.key]));
  const rows = [...t.rows.map(cells), ...t.totalRows.map(cells)];
  const total = t.totalRows.map((_, j) => t.rows.length + j);
  return {
    columns: t.columns.map((c) => ({ label: fill(c.label), width: c.width, align: c.align })),
    rows, bold: [...(b.boldRows ?? []), ...total], total,
  };
}

function resolveBlock(b, values, env, fill) {
  const p = env.params;
  switch (b.type) {
    case 'heading': case 'paragraph': return { ...b, text: fill(b.text) };
    case 'bullets': case 'numbered': return { ...b, items: b.items.map((i) => fill(i)) };
    case 'keyValue': return { ...b, rows: b.rows.map(([k, v]) => [fill(k), fill(v)]) };
    case 'table': return { type: 'table', style: b.style, model: inputTable(b, fill) };
    case 'custom': {
      const data = b.data ?? {};
      if (b.name === 'feeTable') {
        const def = p.feeTables[data.kind];
        return { type: 'table', style: mergeStyle(def.style ?? {}, b.style ?? {}), model: feeTable(data, values, env, fill) };
      }
      const r = feeRates(p.fees, values.fees, data.rates);
      const rateScope = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));
      if (b.name === 'feeCard') {
        const d = { ...p.feeCard, ...data };
        const f = (t) => fill(t, rateScope);
        return { type: 'custom', name: 'feeCard', data: { label: f(d.label), value: f(d.value), title: f(d.title), text: f(d.text) } };
      }
      if (b.name === 'priceCard') {
        const d = { ...p.priceCard, ...data };
        const amount = data.amount !== undefined ? coerceMoney(data.amount).value : values.price;
        const extra = {
          ...rateScope,
          amount: letterMoney(env.fmt, amount),
          amountWords: env.fmt.amountInWords(amount, { currency: false }),
          amountWordsFull: env.fmt.amountInWords(amount),
        };
        const taxLabel = fill(d.taxLabel, extra);
        const f = (t) => fill(t, { ...extra, taxLabel });
        return {
          type: 'custom', name: 'priceCard',
          data: { label: f(d.label), amount: f(d.amountFormat ?? '{amount}'), taxLabel, title: f(d.title), text: f(d.text), words: f(d.words) },
        };
      }
      if (b.name === 'signOff') return { type: 'custom', name: 'signOff', data: { columns: values.signOff.columns } };
      throw new Error(`unknown custom block "${b.name}"`);
    }
    default: return { ...b };
  }
}

/**
 * The interpolation scope: the brand (with `{contact.*}`), every field formatted for print (letterScope), plus
 * `{company}`, `{companyUpper}`, `{client}`, `{clientUpper}`, `{event}` (the engagement's name, or the `event` field),
 * `{product}` (the product's name, else the brand's short name), `{date}` (`params.dateStyle`), `{number}`, `{code}`,
 * the fee rates (`{platformPercent}`…) and `{price}` / `{priceWords}`.
 */
function scopeOf(values, env) {
  const { brand, fmt, params } = env;
  const r = values.rates ?? rates(values, env);
  const extra = {
    company: brand.legalName,
    companyUpper: String(brand.legalName).toUpperCase(),
    client: values.client?.name ?? '',
    clientUpper: String(values.client?.name ?? '').toUpperCase(),
    event: present(values.event) ? values.event : values.engagement?.name ?? '',
    product: values.product?.name ?? brand.shortName ?? brand.legalName,
    date: values.date ? fmt.date(values.date, params.dateStyle ?? 'long') : '',
    number: referenceNumber(values, env),
    code: values.code ?? '',
    ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])),
  };
  if (Number.isSafeInteger(values.examplePrice)) extra.examplePrice = fmt.money(values.examplePrice);
  if (Number.isSafeInteger(values.price)) {
    extra.price = letterMoney(fmt, values.price);
    extra.priceWords = fmt.amountInWords(values.price, { currency: false });
  }
  return letterScope(values, env, extra);
}

/** Cover detail rows `[{ label, value }]`: a value with several lines continues on rows without a label; empty rows are left out. */
function detailRows(rows, fill) {
  const out = [];
  for (const r of rows ?? []) {
    const lines = fill(r.value).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((l, i) => out.push({ label: i === 0 ? fill(r.label) : '', value: l }));
  }
  return out;
}

/**
 * Everything the frame draws: `{ cover, contents, sections }` with the blocks resolved (text interpolated, fee
 * tables calculated, cards filled). Placeholders that print empty in section text are added to `env.warnings`.
 * @param {Record<string, any>} values @param {object} env @param {'proposal'|'report'} kind
 */
export function proposalModel(values, env, kind = 'proposal') {
  const p = env.params;
  const scope = scopeOf(values, env);
  const warned = new Set();
  const fill = filler(scope, warned);
  const quiet = filler(scope, null);
  const preparedFor = textLines(values.preparedFor).join('\n') || scope.client;
  const coverScope = { preparedFor, preparedForFirst: preparedFor.split('\n')[0] };
  const q = (t) => quiet(t, coverScope).trim();
  const c = p.cover ?? {};

  const cover = kind === 'report'
    ? {
      style: c.style ?? 'report',
      title: q(values.coverTitle ?? c.title), subtitle: q(values.subtitle ?? c.subtitle),
      preparedForLabel: q(c.preparedForLabel), preparedFor: q('{preparedForFirst}'),
      preparedByLabel: q(c.preparedByLabel), preparedBy: q(c.preparedBy),
      detailsTitle: q(c.detailsTitle), details: (c.details ?? []).map((t) => q(t)).filter(Boolean),
    }
    : {
      style: c.style ?? 'details',
      title: q(values.coverTitle ?? c.title), subtitle: q(values.subtitle ?? c.subtitle),
      description: q(values.description ?? c.description), meta: q(values.coverNote ?? c.meta),
      detailsTitle: q(c.detailsTitle),
      details: detailRows(c.details, (t) => quiet(t, coverScope)),
      parties: (c.parties ?? []).map((x) => ({ label: q(x.label), value: q(x.value) })).filter((x) => x.value),
    };

  const h = p.headings ?? {};
  const list = values.sectionList ?? sections(values, env);
  const contents = [];
  const resolved = list.map((s, i) => {
    const n = String(i + 1);
    const title = fill(s.title);
    const key = `s${n}`;
    if (s.toc !== false) contents.push({ num: `${n}.`, text: interpolate(h.contents ?? '{title}', { n, title }), key, sub: false });
    const subsections = (s.subsections ?? []).map((x, j) => {
      const sn = `${n}.${j + 1}`;
      const st = fill(x.title);
      if (h.subsectionsInContents !== false && x.toc !== false) {
        contents.push({ num: null, text: interpolate(h.contentsSubsection ?? '{n} {title}', { n: sn, title: st }), key: `s${sn}`, sub: true });
      }
      return {
        key: `s${sn}`, heading: interpolate(h.subsection ?? '{n}  {title}', { n: sn, title: st }), level: x.level, breakMin: x.breakMin,
        divider: x.divider, blocks: (x.blocks ?? []).map((b) => resolveBlock(b, values, env, fill)), title: st,
      };
    });
    return {
      key, heading: interpolate(h.section ?? '{n}. {title}', { n, title }), level: s.level, newPage: s.newPage === true,
      breakMin: s.breakMin, divider: s.divider, blocks: (s.blocks ?? []).map((b) => resolveBlock(b, values, env, fill)), subsections, title,
    };
  });
  if (Array.isArray(env.warnings)) {
    for (const name of warned) env.warnings.push({ code: 'PLACEHOLDER_EMPTY', name, message: `{${name}} has no value and prints as empty text` });
  }
  return {
    cover,
    contents: p.contents === false ? null : { title: q(p.contents?.title ?? 'Contents'), entries: contents },
    sections: resolved,
  };
}

// ---------------------------------------------------------------- renditions

/** The frame of a template: PROPOSAL_FRAME or REPORT_FRAME with `params.frame` merged over it. */
export function proposalFrame(params, kind) {
  return mergeStyle(kind === 'report' ? REPORT_FRAME : PROPOSAL_FRAME, params.frame ?? {});
}

const esc = escapeHtml;

function cardHtml(d, rows) {
  return `<div class="proposal-card" style="margin:6pt 0 14pt;padding:14pt 18pt;border-radius:4pt;background:#1a1a1a;color:#ffffff;display:flex;gap:18pt;break-inside:avoid">`
    + `<div style="min-width:100pt">${rows.left.map(([t, s, w]) => `<div style="font-size:${s}pt;font-weight:${w}">${esc(t)}</div>`).join('')}</div>`
    + `<div>${rows.right.map(([t, s, w]) => `<div style="font-size:${s}pt;font-weight:${w};margin-bottom:4pt">${esc(t)}</div>`).join('')}</div></div>`;
}

/** Shared-format blocks of one resolved model block (HTML and Markdown renditions). */
function outputBlocks(b) {
  if (b.type === 'table') {
    const m = b.model;
    const keyed = (cells) => Object.fromEntries(cells.map((c, i) => [`c${i}`, c]));
    const total = new Set(m.total);
    const bold = new Set(m.bold);
    // Total rows that end the table stay total rows; any other bold or total row keeps its place, marked bold.
    let tail = m.rows.length;
    while (tail > 0 && total.has(tail - 1)) tail--;
    const marked = (cells, i) => (bold.has(i) ? cells.map((x) => (x ? `**${x}**` : x)) : cells);
    return [{
      type: 'table',
      columns: m.columns.map((c, i) => ({ key: `c${i}`, label: c.label, width: c.width, align: c.align ?? 'left' })),
      rows: m.rows.slice(0, tail).map((cells, i) => keyed(marked(cells, i))),
      totalRows: m.rows.slice(tail).map(keyed),
    }];
  }
  if (b.type === 'pageBreak' && b.minSpace !== undefined) return [];
  if (b.type === 'custom' && b.name === 'feeCard') {
    const d = b.data;
    return [{ type: 'custom', name: 'feeCard', data: {
      html: cardHtml(d, { left: [[d.label, 8.5, 600], [d.value, 36, 800]], right: [[d.title, 11.5, 700], [d.text, 9.5, 400]] }),
      md: `> **${d.label}: ${d.value}**  \n> **${d.title}**  \n> ${d.text}`,
    } }];
  }
  if (b.type === 'custom' && b.name === 'priceCard') {
    const d = b.data;
    return [{ type: 'custom', name: 'priceCard', data: {
      html: cardHtml(d, { left: [[d.label, 8.5, 600], [d.amount, 32, 800], [d.taxLabel, 8, 400]], right: [[d.title, 11.5, 700], [d.text, 9.5, 400], [d.words, 9.5, 600]] }),
      md: [`> **${d.label}: ${d.amount}**${d.taxLabel ? ` (${d.taxLabel})` : ''}`, `> **${d.title}**`, `> ${d.text}`, ...(d.words ? [`> ${d.words}`] : [])].join('  \n'),
    } }];
  }
  if (b.type === 'custom' && b.name === 'signOff') {
    const cols = b.data.columns;
    const n = Math.max(...cols.map((c) => c.rows.length));
    return [{
      type: 'table',
      columns: cols.map((c, i) => ({ key: `c${i}`, label: c.heading })),
      rows: Array.from({ length: n }, (_, r) => Object.fromEntries(cols.map((c, i) => [`c${i}`, c.rows[r] ? `${c.rows[r][0]} ${c.rows[r][1]}`.trim() : '']))),
    }];
  }
  const { style, ...rest } = b;
  return [rest];
}

/** Blocks for the HTML and Markdown renditions (contents without page numbers). */
export function modelBlocks(m) {
  const out = [{ type: 'heading', level: 1, text: m.cover.title, align: 'center' }];
  for (const t of [m.cover.subtitle, m.cover.description, m.cover.meta]) if (t) out.push({ type: 'paragraph', text: t, align: 'center' });
  if (m.cover.preparedFor) out.push({ type: 'paragraph', text: `${m.cover.preparedForLabel}  \n**${m.cover.preparedFor}**`, align: 'center' });
  if (m.cover.preparedBy) out.push({ type: 'paragraph', text: `${m.cover.preparedByLabel}  \n**${m.cover.preparedBy}**`, align: 'center' });
  if (m.cover.style === 'stacked') for (const x of m.cover.parties ?? []) out.push({ type: 'paragraph', text: `${x.label}  \n**${x.value}**`, align: 'center' });
  if (m.cover.detailsTitle) out.push({ type: 'heading', level: 3, text: m.cover.detailsTitle });
  if (m.cover.details?.length) {
    if (typeof m.cover.details[0] === 'string') out.push({ type: 'paragraph', text: m.cover.details.join('  \n'), align: 'left' });
    else {
      const rows = [];
      for (const d of m.cover.details) {
        if (!d.label && rows.length) rows[rows.length - 1][1] += `, ${d.value}`;
        else rows.push([d.label, d.value]);
      }
      out.push({ type: 'keyValue', rows });
    }
  }
  if (m.contents) {
    out.push({ type: 'divider' }, { type: 'heading', level: 2, text: m.contents.title });
    out.push({ type: 'bullets', items: m.contents.entries.map((e) => (e.sub ? `  ${e.text}` : `${e.num} ${e.text}`)) });
  }
  for (const s of m.sections) {
    out.push({ type: 'divider' }, { type: 'heading', level: Math.min(s.level ?? 1, 2), text: s.heading });
    for (const b of s.blocks) out.push(...outputBlocks(b));
    for (const sub of s.subsections) {
      out.push({ type: 'heading', level: 2, text: sub.heading });
      for (const b of sub.blocks) out.push(...outputBlocks(b));
    }
  }
  return out;
}

/** HTML block style (proposal sizes; a web rendition, not a facsimile of the PDF). */
export const style = Object.freeze({
  heading: {
    1: { font: 'ExtraBold', size: 18, lineGap: 2, before: 0.3, after: 0.5, uppercase: false, color: 'ink' },
    2: { font: 'Bold', size: 13, lineGap: 1.5, before: 0.2, after: 0.5, uppercase: false, color: 'ink' },
    3: { font: 'SemiBold', size: 12, lineGap: 1.5, before: 0.2, after: 0.4, uppercase: false, color: 'ink' },
  },
  paragraph: { fontSize: 11.5, lineGap: 2.5, regularFont: 'Regular', boldFont: 'Bold', moveDown: 0.65 },
  bullets: { bulletSize: 11.5, bulletX: 0, indent: 14, itemMoveDown: 0.32, moveDown: 0.45 },
  table: { header: { font: 'SemiBold' }, row: { fills: ['#f9f9f9', '#ffffff'] } },
});

/**
 * The module of a proposal-family template.
 * @param {'proposal'|'report'} kind
 */
export function proposalModule(kind) {
  return Object.freeze({
    computed,
    style,
    blocks(values, env) {
      return modelBlocks(proposalModel(values, env, kind));
    },
    async renderPdf(pctx, values, env) {
      await drawProposal(pctx, proposalModel(values, env, kind), {
        frame: proposalFrame(env.params, kind), contact: env.meta.contact, footer: env.params.footer ?? {},
      });
    },
  });
}
