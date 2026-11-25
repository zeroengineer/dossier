/**
 * Document-type keywords used by the legacy importer to recognise a file's type from its name or its text.
 * Pure data and functions; no database. These are generic document kinds, not organisation data: a workspace adds
 * its own (local registrations, in-house document kinds) under `import.typeKeywords` in workspace.json.
 */
import { normaliseName } from './canonical.js';

/**
 * @typedef {{ names: string[], text: string[] }} TypeKeywords
 *   `names`: words or phrases that, found as whole words in a file name, name the type ("pan" matches
 *   "pan_card.pdf" but not "company.pdf"). `text`: phrases that, found in the first part of the extracted text, name it.
 */

/** Built-in keywords per document type. Every type here also has a route in routing.js DEFAULT_ROUTES. */
export const BUILTIN_TYPE_KEYWORDS = Object.freeze({
  // Identity documents (a person's, or the company's PAN).
  'PAN Card': { names: ['pan', 'pancard', 'pan card'], text: ['Permanent Account Number'] },
  'Aadhaar Card': { names: ['aadhaar', 'aadhar'], text: ['Unique Identification Authority'] },
  'Voter ID': { names: ['voter', 'voter id', 'voters card', 'epic'], text: ['Election Commission of India'] },
  'Passport': { names: ['passport'], text: [] },
  // Company identity and registration.
  'GST Certificate': { names: ['gst', 'gstin'], text: ['Form GST REG-06'] },
  'Memorandum of Association': { names: ['moa'], text: ['Memorandum of Association'] },
  'Articles of Association': { names: ['aoa'], text: ['Articles of Association'] },
  'Certificate of Incorporation': { names: ['incorporation'], text: ['Certificate of Incorporation'] },
  'Startup Recognition Certificate': { names: ['dpiit', 'startup india', 'recognition'], text: [] },
  'Udyam Certificate': { names: ['udyam', 'msme'], text: [] },
  // Banking.
  'Cancelled Cheque': { names: ['cancelled check', 'cancelled cheque', 'canceled check', 'canceled cheque'], text: [] },
  'Bank Letter': { names: ['bank letter', 'account details'], text: [] },
  // Company and product material.
  'Letterhead': { names: ['letterhead'], text: [] },
  'Product Plan': { names: ['product plan', 'playbook'], text: [] },
  'Pricing': { names: ['pricing', 'fees structure', 'fee structure', 'price list'], text: [] },
  'PRD': { names: ['prd', 'product requirements'], text: ['Product Requirements Document'] },
  'User Flow': { names: ['userflow', 'user flow'], text: [] },
  'Specification': { names: ['feature spec'], text: [] },
  'Settlement Statement': { names: ['settlement'], text: [] },
  // Existing generated kinds, recognised from the heading of their text when the file name says nothing.
  'Proposal': { names: [], text: ['Service Proposal', 'Partnership Proposal', 'Proposal for'] },
  'Brochure': { names: [], text: ['Brochure'] },
  'Internship Offer': { names: [], text: ['Offer of Internship'] },
  'MoU': { names: [], text: ['Memorandum of Understanding'] },
  'Invoice': { names: [], text: ['Tax Invoice'] },
});

/** Types that are identity documents: imported Confidential at least, like files in an identity folder. */
export const IDENTITY_TYPES = Object.freeze(['PAN Card', 'Aadhaar Card', 'Voter ID', 'Passport']);

/** How much of the extracted text the importer reads for type phrases and dates. */
export const TEXT_WINDOW = 3000;

const typeKey = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Lower-cased words of a phrase or file name, padded with a space on each side (`" pan card "`). */
export const wordsOf = (s) => ` ${normaliseName(String(s ?? '').replace(/[_.]+/g, ' ').replace(/-/g, ' '))} `;

/**
 * True when `keyword` appears in `words` (from {@link wordsOf}) as whole words, optionally with a plural "s"
 * ("voter" matches "voters"). A keyword of several words also matches written together ("pan card" in "pancard").
 * @param {string} words
 * @param {string} keyword
 */
export function hasKeyword(words, keyword) {
  const k = wordsOf(keyword).trim();
  if (!k) return false;
  if (words.includes(` ${k} `) || words.includes(` ${k}s `)) return true;
  if (!k.includes(' ')) return false;
  const joined = k.replace(/\s+/g, '');
  return words.split(' ').some((w) => w === joined || w === `${joined}s`);
}

/**
 * Effective keyword table: the built-ins with the workspace's `import.typeKeywords` added (lists are merged; a type
 * only the workspace names is added). Keys are normalised types; `type` keeps the spelling.
 * @param {Record<string, { names?: string[], text?: string[] }>} [extra]
 * @returns {Map<string, { type: string, names: string[], text: string[] }>}
 */
export function typeKeywordTable(extra = {}) {
  const table = new Map();
  const add = (type, kw) => {
    const k = typeKey(type);
    const cur = table.get(k) ?? { type: String(type).trim().replace(/\s+/g, ' '), names: [], text: [] };
    for (const n of kw?.names ?? []) if (!cur.names.includes(n)) cur.names.push(n);
    for (const t of kw?.text ?? []) if (!cur.text.includes(t)) cur.text.push(t);
    table.set(k, cur);
  };
  for (const [t, kw] of Object.entries(BUILTIN_TYPE_KEYWORDS)) add(t, kw);
  for (const [t, kw] of Object.entries(extra ?? {})) add(t, kw);
  return table;
}

/**
 * Type phrase found earliest in a text (its title or heading normally comes first); ties go to the longer phrase.
 * Matching is on whole words, case and punctuation ignored, line breaks counting as spaces.
 * @param {string} text the first {@link TEXT_WINDOW} characters are read
 * @param {Map<string, { type: string, text: string[] }>} table from {@link typeKeywordTable}
 * @returns {{ type: string, phrase: string } | null}
 */
export function textType(text, table) {
  const words = wordsOf(String(text ?? '').slice(0, TEXT_WINDOW));
  let best = null;
  for (const { type, text: phrases } of table.values()) {
    for (const phrase of phrases) {
      const k = wordsOf(phrase).trim();
      if (!k) continue;
      const at = words.indexOf(` ${k} `);
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && k.length > best.len)) best = { type, phrase, at, len: k.length };
    }
  }
  return best ? { type: best.type, phrase: best.phrase } : null;
}

// ---------- dates ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';

/** Date shapes, each giving [day, month, year] from a match. All numeric forms are day first. */
const DATE_FORMS = [
  // 2026-03-05
  { re: /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/iy, dmy: (m) => [m[3], m[2], m[1]] },
  // 05/03/2025, 05-03-2025, 05.03.2025
  { re: /(?<!\d)(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(?!\d)/iy, dmy: (m) => [m[1], m[3], m[4]] },
  // 5 March 2025, 12th Mar, 2025, 22nd day of September, 2026
  { re: new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s*(?:(?:day\\s+)?of\\s+)?${MONTH_RE}\\.?,?\\s*(\\d{4})(?!\\d)`, 'iy'), dmy: (m) => [m[1], m[2], m[3]] },
  // March 5, 2025, Mar 12th 2025
  { re: new RegExp(`(?<![a-z])${MONTH_RE}\\.?\\s+(\\d{1,2})${ORD},?\\s*(\\d{4})(?!\\d)`, 'iy'), dmy: (m) => [m[2], m[1], m[3]] },
];

/**
 * ISO date of day/month/year parts when it exists and is plausible: not before 1990 and not more than a year after
 * `now`.
 * @returns {string|null}
 */
export function plausibleDate(day, month, year, now = new Date()) {
  const d = Number(day);
  const mo = typeof month === 'string' && /[a-z]/i.test(month) ? MONTHS.indexOf(month.slice(0, 3).toLowerCase()) + 1 : Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(mo) || !Number.isInteger(y) || mo < 1 || mo > 12 || d < 1) return null;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990) return null;
  const limit = new Date(now);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  if (t > limit.getTime()) return null;
  return dt.toISOString().slice(0, 10);
}

/** The date written at `index` of `s` (any of the supported shapes), or null. */
function dateAt(s, index, now) {
  for (const f of DATE_FORMS) {
    f.re.lastIndex = index;
    const m = f.re.exec(s);
    if (m) {
      const iso = plausibleDate(...f.dmy(m), now);
      if (iso) return iso;
    }
  }
  return null;
}

/** Labels that introduce a document's own date (longest first, so "Date of Issue" wins over "Date"). */
const LABEL_RE = /(?<![a-z])(date\s+of\s+issue|date\s+of\s+incorporation|invoice\s+date|issued\s+on|dated|date|w\.?\s?e\.?\s?f\.?)(?![a-z])[\s:.\-–—]*/giu;

/** Words just before a date that make it someone's birth date or an expiry, never the document's date. */
const NOT_DOC_DATE_RE = /(birth|d\.?\s?o\.?\s?b\.?|valid\s+(till|until|upto|up\s+to)|expir\w*)[\s:.\-–—]*$/i;
/** Words in the gap after a label that make the date not the document's. */
const NOT_DOC_WORD_RE = /birth|\bd\.?\s?o\.?\s?b\b|valid|expir/i;

/**
 * The document date written in a text: the first labelled date ("Date: 05/03/2025", "Dated 5th March 2025",
 * "Date of Issue", "Issued on", "Invoice Date", "Date of Incorporation", "w.e.f."), else (unless `labelledOnly`) the
 * first plausible date. A label may be followed by a few words on the same line before its date ("Date of
 * Registration 14/02/2026"), but not by birth or expiry words. Only the first {@link TEXT_WINDOW} characters are
 * read. Numeric dates are day first.
 * @param {string} text
 * @param {{ now?: Date, labelledOnly?: boolean }} [opts]
 * @returns {{ date: string, labelled: boolean } | null}
 */
export function findTextDate(text, { now = new Date(), labelledOnly = false } = {}) {
  const s = String(text ?? '').slice(0, TEXT_WINDOW);
  for (const m of s.matchAll(LABEL_RE)) {
    const start = m.index + m[0].length;
    const direct = dateAt(s, start, now);
    if (direct) return { date: direct, labelled: true };
    // Try each position in a short same-line gap after the label.
    const gapEnd = Math.min(s.length, start + 30);
    for (let i = start + 1; i <= gapEnd; i++) {
      if (/[\d\n]/.test(s[i - 1])) break;
      if (NOT_DOC_WORD_RE.test(s.slice(start, i))) break;
      const iso = dateAt(s, i, now);
      if (iso) return { date: iso, labelled: true };
    }
  }
  if (labelledOnly) return null;
  for (let i = 0; i < s.length; i++) {
    if (!/[0-9a-z]/i.test(s[i]) || (i > 0 && /[0-9a-z]/i.test(s[i - 1]))) continue;
    const iso = dateAt(s, i, now);
    if (iso && !NOT_DOC_DATE_RE.test(s.slice(Math.max(0, i - 30), i))) return { date: iso, labelled: false };
  }
  return null;
}
