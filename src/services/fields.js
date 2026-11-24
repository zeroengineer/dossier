// Field resolution: turn a template's field list + partial input into values, the fields still to ask, and errors.
import { DossierError, isDossierError } from '../errors.js';
import { createFormatter } from '../render/pdf/format.js';
import { parseSource } from '../workspace/templateSchema.js';
import { getEntity } from './entities.js';
import { getTemplate } from './templates.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/**
 * Read a dotted path (`a.b.0.c`, `a[0].c`) from an object, following own properties only; undefined when any step
 * is missing.
 * @param {any} obj @param {string} path
 * @returns {any}
 */
export function getPath(obj, path) {
  let v = obj;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (v == null || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined;
    v = v[part];
  }
  return v;
}

function deepFreeze(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (!isPlainObject(o[p])) o[p] = {};
    o = o[p];
  }
  o[parts.at(-1)] = value;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** Today's local date as `YYYY-MM-DD`. */
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function isoDate(y, m, d) {
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Coerce a date to ISO `YYYY-MM-DD`: a Date (local), `YYYY-MM-DD` (time part ignored) or `DD/MM/YYYY`
 * (also `-` or `.` separated).
 * @param {unknown} v
 * @returns {{ value: string } | { error: string }}
 */
export function coerceDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { error: 'invalid date' } : { value: todayIso(v) };
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(s);
  let iso = m && isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!m) {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    iso = m && isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  }
  return iso ? { value: iso } : { error: `"${s}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)` };
}

/** Thousands grouping: `120,000` or Indian `1,20,000` (first group 1-3 digits, last 3, middle 2 or 3). */
function validGrouping(int) {
  if (!int.includes(',')) return /^\d+$/.test(int);
  const g = int.split(',');
  return /^\d{1,3}$/.test(g[0]) && /^\d{3}$/.test(g.at(-1)) && g.slice(1, -1).every((x) => /^\d{2,3}$/.test(x));
}

/**
 * Coerce an amount in major units to integer minor units, rounding half up at the third decimal. Accepts numbers and
 * strings with an optional currency prefix (`₹`, `Rs.`, `INR`), a sign before or after it, and `,` grouping
 * (`120,000` or `1,20,000`; `1,2,3` is rejected). An empty or whitespace-only string is an error ("empty").
 * @param {unknown} v
 * @returns {{ value: number } | { error: string }}
 */
export function coerceMoney(v) {
  let sign;
  let int;
  let frac;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { error: `${v} is not an amount` };
    const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(Math.abs(v) < 1e21 ? v.toFixed(6) : String(v));
    if (!m) return { error: `${v} is too large` };
    [, sign, int, frac] = m;
  } else if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return { error: 'amount is empty' };
    const m = /^(-?)\s*(?:[^\d\s.,-]+\.?\s*)?(-?)\s*([\d,]+)(?:\.(\d*))?$/.exec(t);
    if (!m || (m[1] && m[2]) || !validGrouping(m[3])) return { error: `"${v}" is not an amount` };
    sign = m[1] || m[2];
    int = m[3].replace(/,/g, '');
    frac = m[4];
  } else {
    return { error: 'expected an amount' };
  }
  const f = (frac ?? '').padEnd(3, '0');
  let minor = Number(int) * 100 + Number(f.slice(0, 2)) + (Number(f[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(minor)) return { error: `"${v}" is too large` };
  if (sign && minor) minor = -minor;
  return { value: minor };
}

const TRUE = ['true', 'yes', '1', 'on'];
const FALSE = ['false', 'no', '0', 'off', ''];

/**
 * Coerce one value to a field type. Money from `computed` sources and from paths to values already coerced as money
 * is in minor units (`minor: true`).
 * @param {string|undefined} type
 * @param {unknown} v
 * @param {{ minor?: boolean }} [opts]
 * @returns {{ value: unknown } | { error: string }}
 */
export function coerceValue(type, v, { minor = false } = {}) {
  switch (type) {
    case undefined:
    case 'entity':
      return { value: v };
    case 'string':
    case 'text':
    case 'enum':
      if (typeof v === 'string') return { value: type === 'text' ? v : v.trim() };
      if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return { value: String(v) };
      return { error: 'expected text' };
    case 'number': {
      const n = typeof v === 'string' ? Number(v.replace(/[\s,]/g, '')) : v;
      return typeof n === 'number' && Number.isFinite(n) && !(typeof v === 'string' && v.trim() === '') ? { value: n } : { error: `"${v}" is not a number` };
    }
    case 'money':
      if (minor) return Number.isSafeInteger(v) ? { value: v } : { error: 'amount must already be an integer number of minor units' };
      return coerceMoney(v);
    case 'date':
      return coerceDate(v);
    case 'boolean': {
      if (typeof v === 'boolean') return { value: v };
      const s = String(v).trim().toLowerCase();
      if (TRUE.includes(s)) return { value: true };
      if (FALSE.includes(s)) return { value: false };
      return { error: `"${v}" is not yes/no` };
    }
    case 'array':
      return Array.isArray(v) ? { value: v } : { error: 'expected a list' };
    case 'object':
      return isPlainObject(v) ? { value: v } : { error: 'expected an object' };
    default:
      return { error: `unknown type "${type}"` };
  }
}

const isBlank = (v) => typeof v === 'string' && v.trim() === '';
const isEmpty = (v) => v === undefined || v === null || isBlank(v) || (Array.isArray(v) && v.length === 0);

/** Default strings that are read as a source instead of a literal. */
const isSourceDefault = (d) => typeof d === 'string' && (d === 'today' || d === 'brand' || /^(brand\.|const:|computed:)/.test(d));

/**
 * Resolve a template's fields. See docs/TEMPLATES.md for the sources. Values are built in field order (a field can
 * read earlier fields), nested by dotted names (`billTo.name` -> `values.billTo.name`). Input (nested or with dotted
 * keys) overrides every source when provided. Required fields still empty are listed in `missing`; bad values, unknown
 * entities and signatories and failing computed functions in `errors`.
 * @param {object} ctx
 * @param {string} templateId
 * @param {Record<string, unknown>} [input]
 * @param {{ brandId?: string, dirs?: string[], today?: string }} [opts] `today` (YYYY-MM-DD) pins the `today` source
 * @returns {Promise<{ values: Record<string, unknown>, missing: Array<{ name: string, label: string, type: string,
 *   enum?: string[], help?: string }>, errors: Array<{ name: string, message: string }> }>}
 */
export async function resolveFields(ctx, templateId, input = {}, opts = {}) {
  const template = await getTemplate(ctx, templateId, { dirs: opts.dirs });
  return resolveTemplateFields(ctx, template, input, opts);
}

/**
 * resolveFields for an already loaded template (`getTemplate` result).
 * @param {object} ctx
 * @param {{ id: string, meta: object, module: object }} template
 * @param {Record<string, unknown>} [input]
 * @param {{ brandId?: string, today?: string }} [opts]
 */
export function resolveTemplateFields(ctx, template, input = {}, { brandId, today } = {}) {
  if (!isPlainObject(input)) throw new DossierError('INVALID_INPUT', 'Field input must be an object');
  const bid = brandId ?? ctx.ws.config.defaultBrand;
  const wsBrand = ctx.ws.brands.get(bid);
  if (!wsBrand) throw new DossierError('BRAND_NOT_FOUND', `No brand "${bid}" in the workspace`, { brandId: bid });
  const brand = deepFreeze(structuredClone(wsBrand)); // templates get a copy they cannot change
  const { meta, module } = template;
  const env = { ctx, brand, meta, params: meta.params, fmt: createFormatter(ctx.ws.config.locale), input };

  const values = {};
  const missing = [];
  const errors = [];

  const fromSource = (src, f) => {
    switch (src.kind) {
      case 'today': return today ?? todayIso();
      case 'brand': return brand;
      case 'brandPath': return getPath(brand, src.arg);
      case 'signatory': return brand.defaultSignatory?.[meta.id] ?? brand.defaultSignatory?.[meta.category];
      case 'const': return structuredClone(src.arg);
      case 'fieldPath': return getPath(values, src.arg);
      case 'computed': {
        const fn = module.computed?.[src.arg];
        if (typeof fn !== 'function') throw new Error(`template exports no computed.${src.arg}()`);
        return fn(values, env);
      }
      default: return undefined; // ask, entity: input only
    }
  };

  const enumList = (f) => {
    if (f.enum === undefined) return undefined;
    if (Array.isArray(f.enum)) return f.enum;
    const src = parseSource(f.enum);
    const list = src.error ? undefined : fromSource(src, f);
    if (!Array.isArray(list)) {
      errors.push({ name: f.name, message: `enum source "${f.enum}" is not a list` });
      return undefined;
    }
    return list.map((x) => (isPlainObject(x) ? String(x.id) : String(x)));
  };

  // Value paths (`total`, `perks.0.amount`) that hold money already coerced to minor units in this resolution.
  const minorPaths = new Set();
  for (const f of meta.fields) {
    const src = parseSource(f.source);
    const fail = (message) => errors.push({ name: f.name, message });
    let provided = getPath(input, f.name);
    if (provided === undefined && Object.hasOwn(input, f.name)) provided = input[f.name];
    // Blank input (HTML forms post '') counts as not provided: sources and defaults apply, and a required field
    // that is still empty is reported as missing.
    if (isBlank(provided)) provided = undefined;
    let origin = 'input';
    let raw = provided;
    try {
      if (raw === undefined || raw === null) {
        raw = src.kind === 'ask' ? undefined : fromSource(src, f);
        origin = src.kind;
        // A path to a value coerced as money earlier in this resolution is minor units already; anything else read
        // through a path (objects, brand data, entity attrs, constants) is raw input.
        if (src.kind === 'fieldPath') origin = { path: normalisePath(src.arg) };
      }
      if ((raw === undefined || raw === null) && f.default !== undefined) {
        const dsrc = isSourceDefault(f.default) ? parseSource(f.default) : null;
        raw = dsrc ? fromSource(dsrc, f) : structuredClone(f.default);
        origin = dsrc?.kind === 'computed' ? 'computed' : 'default';
      }
    } catch (e) {
      fail(e.message);
      continue;
    }

    const choices = enumList(f);
    let value = raw;
    if (!isEmpty(value)) {
      if (src.kind === 'entity' || f.type === 'entity') {
        value = resolveEntityValue(ctx, value, src.kind === 'entity' ? src.arg : undefined, fail);
        if (value === undefined) continue;
      } else if (src.kind === 'signatory') {
        const sid = isPlainObject(value) ? value.id : String(value);
        const s = brand.signatories.find((x) => x.id === sid);
        if (!s) {
          fail(`brand "${brand.id}" has no signatory "${sid}"`);
          continue;
        }
        value = { ...s };
      } else {
        const minor = origin === 'computed' || (origin.path !== undefined && minorPaths.has(origin.path));
        const r = coerceValue(f.type, value, { minor });
        if (r.error) {
          fail(r.error);
          continue;
        }
        value = r.value;
        if (f.type === 'money') minorPaths.add(f.name);
        if (f.type === 'array' && f.item) {
          const itemMinor = (i, key) => origin === 'computed' || (origin.path !== undefined && minorPaths.has(`${origin.path}.${i}.${key}`));
          value = coerceItems(f, value, itemMinor, errors, minorPaths);
        }
      }
    }
    if (isEmpty(value)) {
      if (f.required) {
        const m = { name: f.name, label: f.label ?? f.name, type: f.type ?? (src.kind === 'entity' ? 'entity' : 'string') };
        if (choices) m.enum = choices;
        if (f.help) m.help = f.help;
        missing.push(m);
      }
      if (value === undefined || value === null || isBlank(value)) continue;
    }
    if (choices && !isEmpty(value) && !choices.includes(String(value))) {
      fail(`"${value}" is not one of ${choices.join(', ')}`);
      continue;
    }
    setPath(values, f.name, value);
  }
  return { values, missing, errors };
}

const normalisePath = (p) => p.replace(/\[(\d+)\]/g, '.$1');

function coerceItems(f, list, isMinor, errors, minorPaths) {
  return list.map((item, i) => {
    if (!isPlainObject(item)) {
      errors.push({ name: `${f.name}.${i}`, message: 'expected an object' });
      return item;
    }
    const out = { ...item };
    for (const [key, type] of Object.entries(f.item)) {
      if (isEmpty(out[key])) continue;
      const r = coerceValue(type, out[key], { minor: isMinor(i, key) });
      if (r.error) errors.push({ name: `${f.name}.${i}.${key}`, message: r.error });
      else {
        out[key] = r.value;
        if (type === 'money') minorPaths.add(`${f.name}.${i}.${key}`);
      }
    }
    return out;
  });
}

function resolveEntityValue(ctx, v, kind, fail) {
  const ref = isPlainObject(v) ? v.id ?? v.name : v;
  try {
    const e = getEntity(ctx, ref, kind ? { kind } : {});
    if (kind && e.kind !== kind) {
      fail(`entity ${e.id} is a ${e.kind}, not a ${kind}`);
      return undefined;
    }
    return e;
  } catch (err) {
    if (isDossierError(err) && ['ENTITY_NOT_FOUND', 'ENTITY_AMBIGUOUS', 'INVALID_INPUT'].includes(err.code)) {
      fail(err.message);
      return undefined;
    }
    throw err;
  }
}
