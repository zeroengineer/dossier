import { DossierError } from '../errors.js';

/**
 * Numbering pattern engine (pure). A pattern is literal text plus tokens:
 * `{YYYY}` `{YY}` `{MM}` calendar year / 2-digit year / month of the document date, `{FY}` Indian financial year
 * (April-March, `2026-27`), `{CLIENT}` `{CODE}` `{BRAND}` codes (uppercased, sanitised to `[A-Z0-9-]`), and exactly one
 * counter `{#}`, `{##}`, … (zero-padded to the number of `#`, never truncated).
 */

/** Tokens a pattern may use besides the counter. */
export const NUMBER_TOKENS = ['YYYY', 'YY', 'MM', 'FY', 'CLIENT', 'CODE', 'BRAND'];

/** Counter scopes (`series.json` `scope`). */
const SCOPES = ['global', 'brand', 'brand+year', 'brand+year+client', 'brand+year+code'];

/** Prefix of every numbering row in `sequences` (keeps them apart from the `doc-id` counter). */
export const SCOPE_KEY_PREFIX = 'num:';

const TOKEN_RE = /\{([^{}]*)\}/g;
const CODE_RE = '[A-Z0-9]+(?:-[A-Z0-9]+)*';
const CODE_VAR = { CLIENT: 'client', CODE: 'code', BRAND: 'brand' };

const invalidPattern = (pattern, why) => new DossierError('SERIES_PATTERN_INVALID', `Numbering pattern "${pattern}": ${why}`, { pattern });
const missing = (name, extra = {}) => new DossierError('NUMBER_VAR_MISSING', `A number needs a value for ${name}`, { var: name, ...extra });

/**
 * Split a pattern into literal and token parts. Throws SERIES_PATTERN_INVALID for an unknown `{…}` token or a
 * pattern without exactly one counter.
 * @param {string} pattern
 * @returns {Array<{ literal: string } | { token: string, width?: number }>} counter parts have token '#' and a width
 */
export function patternTokens(pattern) {
  if (typeof pattern !== 'string' || pattern === '') throw invalidPattern(String(pattern), 'must be a non-empty string');
  const parts = [];
  let last = 0;
  let counters = 0;
  for (const m of pattern.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ literal: pattern.slice(last, m.index) });
    const name = m[1];
    if (/^#+$/.test(name)) {
      parts.push({ token: '#', width: name.length });
      counters++;
    } else if (NUMBER_TOKENS.includes(name)) parts.push({ token: name });
    else throw invalidPattern(pattern, `unknown token {${name}} (expected ${NUMBER_TOKENS.map((t) => `{${t}}`).join(', ')} or {#…})`);
    last = m.index + m[0].length;
  }
  if (last < pattern.length) parts.push({ literal: pattern.slice(last) });
  if (counters !== 1) throw invalidPattern(pattern, `needs exactly one counter token like {####}, found ${counters}`);
  return parts;
}

/**
 * Uppercase a client/brand/code value and reduce it to `[A-Z0-9-]`: whitespace, `_` and `-` runs become one `-`,
 * other characters are dropped, leading/trailing `-` removed.
 * @param {unknown} value
 * @returns {string} '' when nothing usable is left
 */
export function sanitiseCode(value) {
  if (value === undefined || value === null) return '';
  return String(value).toUpperCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Indian financial year (April-March) of a calendar year and month, as `2026-27`.
 * @param {number} year
 * @param {number} month 1-12
 * @returns {string}
 */
export function financialYear(year, month) {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * True for a financial-year string like `2026-27` whose second part is the year after the first.
 * @param {unknown} fy
 * @returns {boolean}
 */
export function isFinancialYear(fy) {
  if (typeof fy !== 'string' || !/^\d{4}-\d{2}$/.test(fy)) return false;
  const [a, b] = fy.split('-').map(Number);
  return (a + 1) % 100 === b;
}

/** Year and month (1-12) of a `YYYY-MM-DD…` string (taken literally, no time zone shift) or a Date (local time). */
function dateParts(date) {
  if (date === undefined || date === null) return null;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) throw new DossierError('INVALID_INPUT', 'Invalid date', { date: String(date) });
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }
  const m = typeof date === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const month = m ? Number(m[2]) : 0;
  const day = m ? Number(m[3]) : 0;
  const daysInMonth = m ? new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate() : 0;
  if (!m || month < 1 || month > 12 || day < 1 || day > daysInMonth) throw new DossierError('INVALID_INPUT', `Invalid date "${date}" (expected YYYY-MM-DD)`, { date: String(date) });
  return { year: Number(m[1]), month };
}

/**
 * Lazily resolved values of a vars object: `{ date?, year?, month?, fy?, brand?, client?, code?, seq? }`.
 * Explicit year / month / fy win over the date.
 */
function resolver(vars = {}) {
  let dp;
  const fromDate = () => (dp === undefined ? (dp = dateParts(vars.date)) : dp);
  const year = () => {
    const y = vars.year ?? fromDate()?.year;
    if (!Number.isInteger(y)) throw missing('YYYY', { hint: 'pass a date' });
    return y;
  };
  const month = () => {
    const mo = vars.month ?? fromDate()?.month;
    if (!Number.isInteger(mo) || mo < 1 || mo > 12) throw missing('MM', { hint: 'pass a date' });
    return mo;
  };
  const fy = () => {
    if (vars.fy !== undefined && vars.fy !== null) {
      if (!isFinancialYear(vars.fy)) throw new DossierError('INVALID_INPUT', `Invalid financial year "${vars.fy}" (expected e.g. 2026-27)`, { fy: String(vars.fy) });
      return vars.fy;
    }
    const d = fromDate();
    if (!d) throw missing('FY', { hint: 'pass a date' });
    return financialYear(d.year, d.month);
  };
  const codeVar = (token) => {
    const v = sanitiseCode(vars[CODE_VAR[token]]);
    if (!v) throw missing(token);
    return v;
  };
  return { year, month, fy, codeVar };
}

/**
 * Format a number from a pattern and its vars.
 * @param {string} pattern e.g. `ACM-{YYYY}-{####}`
 * @param {{ seq: number, date?: string|Date, year?: number, month?: number, fy?: string, brand?: string,
 *   client?: string, code?: string }} vars
 * @returns {string}
 */
export function formatNumber(pattern, vars = {}) {
  const parts = patternTokens(pattern);
  const r = resolver(vars);
  let out = '';
  for (const p of parts) {
    if ('literal' in p) { out += p.literal; continue; }
    switch (p.token) {
      case '#': {
        if (!Number.isSafeInteger(vars.seq) || vars.seq < 0) throw missing('counter', { hint: 'seq must be a non-negative integer' });
        out += String(vars.seq).padStart(p.width, '0');
        break;
      }
      case 'YYYY': out += String(r.year()).padStart(4, '0'); break;
      case 'YY': out += String(r.year() % 100).padStart(2, '0'); break;
      case 'MM': out += String(r.month()).padStart(2, '0'); break;
      case 'FY': out += r.fy(); break;
      default: out += r.codeVar(p.token);
    }
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

const TOKEN_SOURCE = {
  YYYY: '(\\d{4})',
  YY: '(\\d{2})',
  MM: '(0[1-9]|1[0-2])',
  FY: '(\\d{4}-\\d{2})',
  CLIENT: `(${CODE_RE})`,
  CODE: `(${CODE_RE})`,
  BRAND: `(${CODE_RE})`,
};

/**
 * Anchored regex matching numbers of a pattern; one capture group per token, in pattern order.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function patternToRegex(pattern) {
  const source = patternTokens(pattern)
    .map((p) => ('literal' in p ? escapeRe(p.literal) : p.token === '#' ? `(\\d{${p.width},})` : TOKEN_SOURCE[p.token]))
    .join('');
  return new RegExp(`^${source}$`);
}

/**
 * Parse a number back into vars (`seq` plus whichever of `year`, `month`, `fy`, `client`, `code`, `brand` the
 * pattern has; `{YY}` gives `year` 20YY). Formatting the result with the same pattern gives the number back.
 * @param {string} pattern
 * @param {string} number
 * @returns {{ seq: number, year?: number, month?: number, fy?: string, client?: string, code?: string, brand?: string } | null}
 *   null when the number does not fit the pattern (or its values disagree, e.g. `{YYYY}` and `{YY}`)
 * Code tokens (`{CLIENT}`, `{CODE}`, `{BRAND}`) may contain `-`, so a hyphen next to one is ambiguous: with
 * `{CLIENT}-{CODE}` the number `A-B-C` parses as client `A-B`, code `C` (the regex is greedy, the first code token
 * takes the longest match), and with `{CODE}-{##}` a code ending in `-<digits>` cannot be told from the counter.
 * Separate code tokens with a character they cannot contain (e.g. `/`) when numbers must parse back unambiguously.
 */
export function parseNumber(pattern, number) {
  if (typeof number !== 'string') return null;
  const tokens = patternTokens(pattern).filter((p) => 'token' in p);
  const m = patternToRegex(pattern).exec(number);
  if (!m) return null;
  const vars = {};
  const put = (key, value) => {
    if (key in vars && vars[key] !== value) return false;
    vars[key] = value;
    return true;
  };
  for (let i = 0; i < tokens.length; i++) {
    const raw = m[i + 1];
    let ok;
    switch (tokens[i].token) {
      case '#': ok = put('seq', Number(raw)); break;
      case 'YYYY': ok = put('year', Number(raw)); break;
      case 'YY': ok = 'year' in vars ? vars.year % 100 === Number(raw) : put('year', 2000 + Number(raw)); break;
      case 'MM': ok = put('month', Number(raw)); break;
      case 'FY': ok = isFinancialYear(raw) && put('fy', raw); break;
      default: ok = put(CODE_VAR[tokens[i].token], raw);
    }
    if (!ok || (tokens[i].token === '#' && !Number.isSafeInteger(vars.seq))) return null;
  }
  return vars;
}

/**
 * Which year a pattern's year-scoped counters follow: `'fy'` when it has `{FY}` but no `{YYYY}`, else `'calendar'`.
 * @param {string} pattern
 * @returns {'fy'|'calendar'}
 */
export function yearBasis(pattern) {
  const tokens = new Set(patternTokens(pattern).map((p) => p.token).filter(Boolean));
  return !tokens.has('YYYY') && tokens.has('FY') ? 'fy' : 'calendar';
}

/**
 * The `sequences` key of a series for some vars: `num:<counter>[:<BRAND>][:<year>][:<CLIENT>|:C=<CODE>]` by scope
 * (`global`, `brand`, `brand+year`, `brand+year+client`, `brand+year+code`: one counter per `{CODE}`, e.g. quotations
 * per client/product code). Series sharing a counter share keys. The year part is the
 * calendar year when the pattern has `{YYYY}`, else `FY<fy>` when it has `{FY}`, else the calendar year of the date.
 * @param {{ pattern: string, scope: string, counter?: string, id: string }} series
 * @param {{ date?: string|Date, year?: number, fy?: string, brand?: string, client?: string, code?: string }} vars
 * @returns {string}
 */
export function scopeKey(series, vars = {}) {
  const basis = yearBasis(series.pattern);
  const r = resolver(vars);
  const scope = series.scope ?? 'brand+year';
  if (!SCOPES.includes(scope)) {
    throw new DossierError('INVALID_INPUT', `Unknown series scope "${scope}"`, { scope });
  }
  const parts = [`${SCOPE_KEY_PREFIX}${series.counter ?? series.id}`];
  if (scope !== 'global') parts.push(r.codeVar('BRAND'));
  if (scope.startsWith('brand+year')) {
    parts.push(basis === 'fy' ? `FY${r.fy()}` : String(r.year()));
  }
  if (scope === 'brand+year+client') parts.push(r.codeVar('CLIENT'));
  // `C=` keeps code keys apart from client keys of a series that later changes scope.
  if (scope === 'brand+year+code') parts.push(`C=${r.codeVar('CODE')}`);
  return parts.join(':');
}

/**
 * Find numbers of a pattern inside free text (a file name, extracted text). A match must not be glued to a letter or
 * digit before it or a digit after it. With `looseSeparators`, a literal `/` in the pattern also matches `-` or `_`
 * (file names cannot hold `/`, so `ACM/HR/2026/EXP-004` is often saved as `ACM-HR-2026-EXP-004`). Each hit is given
 * back in the pattern's own form (`number`, separators restored, digits as written) with the vars parseNumber reads.
 * @param {string} pattern
 * @param {string} text
 * @param {{ looseSeparators?: boolean }} [opts]
 * @returns {Array<{ number: string, index: number, length: number, vars: object }>} in text order
 */
export function findNumbers(pattern, text, { looseSeparators = false } = {}) {
  if (typeof text !== 'string' || text === '') return [];
  const parts = patternTokens(pattern);
  const literal = (s) => [...s].map((ch) => (looseSeparators && ch === '/' ? '[/_-]' : escapeRe(ch))).join('');
  const source = parts
    .map((p) => ('literal' in p ? literal(p.literal) : p.token === '#' ? `(\\d{${p.width},})` : TOKEN_SOURCE[p.token]))
    .join('');
  const re = new RegExp(`(?<![A-Za-z0-9])${source}(?![0-9])`, 'g');
  const out = [];
  for (const m of text.matchAll(re)) {
    let g = 1;
    const number = parts.map((p) => ('literal' in p ? p.literal : m[g++])).join('');
    const vars = parseNumber(pattern, number);
    if (vars) out.push({ number, index: m.index, length: m[0].length, vars });
  }
  return out;
}
