// Tiny HTML templating: `html` escapes every interpolation unless it is a `raw()` fragment (or the result of another
// `html` call). Arrays are joined, null/undefined/false print nothing.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** A trusted HTML fragment; `html` inserts it as is. */
export class SafeHtml {
  /** @param {string} value */
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

/**
 * Escape text for element content and quoted attribute values.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
}

/**
 * Mark a string as trusted HTML. Use only for markup built in code, never for data.
 * @param {string} s
 * @returns {SafeHtml}
 */
export const raw = (s) => new SafeHtml(String(s));

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  return escapeHtml(v);
}

/**
 * Tagged template that escapes every `${…}` (arrays joined, nested `html` results kept).
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/**
 * A query string from an object (undefined/null/'' left out), with a leading `?` when not empty.
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
