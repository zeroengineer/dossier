// Block model shared by the PDF, HTML and Markdown renderers (docs/TEMPLATES.md "Blocks"), plus the default block
// style (offer-letter values, docs/DISCOVERY.md A8 §2) that the PDF renderer uses and the HTML renderer mirrors.
import { BULLET_DEFAULTS, CLAUSE_DEFAULTS, DIVIDER_DEFAULTS, PARAGRAPH_DEFAULTS, SECTION_DEFAULTS } from './pdf/text.js';
import { TABLE_DEFAULTS } from './pdf/tables.js';

export const BLOCK_TYPES = Object.freeze([
  'heading', 'paragraph', 'bullets', 'numbered', 'table', 'keyValue', 'signature', 'spacer', 'divider', 'pageBreak', 'custom',
]);

const ALIGNS = ['left', 'center', 'right', 'justify'];
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' || typeof v === 'number';

/** Thrown for a malformed block list; `path` is like `blocks[3].items`. */
export class BlockError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'BlockError';
    this.path = path;
  }
}

/**
 * Normalise a table's columns and rows: columns become `{ key, label, width?, align }` (a string column is its label,
 * keys default to `c0`, `c1`, …); array rows become objects keyed by column key; cells become strings.
 * @param {{ columns: Array<string|{ key?: string, label?: string, width?: number, align?: string }>,
 *   rows: Array<unknown[]|Record<string, unknown>>, totalRows?: Array<unknown[]|Record<string, unknown>> }} block
 * @returns {{ columns: Array<{ key: string, label: string, width?: number, align: string }>,
 *   rows: Array<Record<string, string>>, totalRows: Array<Record<string, string>> }}
 */
export function normaliseTable(block) {
  const columns = block.columns.map((c, i) => {
    const col = typeof c === 'string' ? { label: c } : { ...c };
    return { ...col, key: col.key ?? `c${i}`, label: String(col.label ?? ''), align: col.align ?? 'left' };
  });
  const row = (r) => {
    const out = {};
    columns.forEach((c, i) => {
      const v = Array.isArray(r) ? r[i] : r[c.key];
      out[c.key] = v == null ? '' : String(v);
    });
    return out;
  };
  return { columns, rows: block.rows.map(row), totalRows: (block.totalRows ?? []).map(row) };
}

/**
 * Check a block list and throw BlockError on the first problem. Returns the list unchanged.
 * @param {unknown} blocks
 * @returns {Array<object>}
 */
export function validateBlocks(blocks) {
  if (!Array.isArray(blocks)) throw new BlockError('blocks', 'must be an array');
  blocks.forEach((b, i) => {
    const at = `blocks[${i}]`;
    if (!isPlainObject(b)) throw new BlockError(at, 'must be an object');
    const need = (cond, msg) => {
      if (!cond) throw new BlockError(at, `${b.type}: ${msg}`);
    };
    if (!BLOCK_TYPES.includes(b.type)) throw new BlockError(`${at}.type`, `unknown block type "${b.type}"`);
    if (b.align !== undefined) need(ALIGNS.includes(b.align), `align must be one of ${ALIGNS.join(', ')}`);
    switch (b.type) {
      case 'heading':
        need([1, 2, 3].includes(b.level), 'level must be 1, 2 or 3');
        need(isText(b.text), 'text is required');
        break;
      case 'paragraph':
        need(isText(b.text), 'text is required');
        break;
      case 'bullets':
      case 'numbered':
        need(Array.isArray(b.items) && b.items.every(isText), 'items must be a list of strings');
        break;
      case 'table':
        need(Array.isArray(b.columns) && b.columns.length > 0, 'columns must be a non-empty list');
        need(Array.isArray(b.rows), 'rows must be a list');
        need(b.totalRows === undefined || Array.isArray(b.totalRows), 'totalRows must be a list');
        break;
      case 'keyValue':
        need(Array.isArray(b.rows) && b.rows.every((r) => Array.isArray(r) && r.length === 2), 'rows must be [key, value] pairs');
        break;
      case 'signature':
        need(b.lines === undefined || (Array.isArray(b.lines) && b.lines.every(isText)), 'lines must be a list of strings');
        need(b.signatoryId !== undefined || b.party !== undefined, 'needs signatoryId or party');
        break;
      case 'spacer':
        if (b.lines !== undefined) need(typeof b.lines === 'number' && b.lines >= 0, 'lines must be a non-negative number');
        else need(typeof b.size === 'number' && b.size >= 0, 'size must be a non-negative number');
        break;
      case 'custom':
        need(typeof b.name === 'string' && b.name !== '', 'name is required');
        break;
      default:
        break;
    }
  });
  return blocks;
}

/**
 * Split text with `**bold**` markers into runs.
 * @param {string} text
 * @returns {Array<{ text: string, bold: boolean }>}
 */
export function inlineRuns(text) {
  const runs = [];
  String(text).split('**').forEach((part, i) => {
    if (part) runs.push({ text: part, bold: i % 2 === 1 });
  });
  return runs;
}

/**
 * Default block style (offer letter, docs/DISCOVERY.md A8 §2). Sizes in points; `before`/`after` in lines (pdfkit
 * `moveDown`); colours are palette keys or hex. `cover` entries apply on top of the normal ones to blocks flagged
 * `cover: true` (Markdown cover section).
 */
export const BLOCK_STYLE_DEFAULTS = Object.freeze({
  heading: Object.freeze({
    1: Object.freeze({ ...SECTION_DEFAULTS, color: 'ink' }),
    2: Object.freeze({ ...CLAUSE_DEFAULTS, color: 'ink' }),
    3: Object.freeze({ font: 'BodyBold', size: 10.5, lineGap: 1.5, before: 0.3, after: 0.35, breakMin: 60, uppercase: false, color: 'ink' }),
  }),
  coverHeading: Object.freeze({ 1: Object.freeze({ align: 'center' }), 2: Object.freeze({ align: 'center' }), 3: Object.freeze({ align: 'center' }) }),
  paragraph: Object.freeze({ ...PARAGRAPH_DEFAULTS, color: 'body', boldColor: undefined }),
  coverParagraph: Object.freeze({ align: 'center' }),
  bullets: Object.freeze({ ...BULLET_DEFAULTS }),
  numbered: Object.freeze({ ...BULLET_DEFAULTS, bulletX: 0, indent: 18 }),
  table: Object.freeze({
    before: 0.35, after: 0.9,
    header: Object.freeze({ ...TABLE_DEFAULTS.header, fill: 'ink', color: 'white' }),
    row: Object.freeze({ ...TABLE_DEFAULTS.row, fills: Object.freeze(['fillAlt', 'white']), color: 'body' }),
    total: Object.freeze({ ...TABLE_DEFAULTS.total, fill: 'fillTotal', color: 'ink' }),
  }),
  keyValue: Object.freeze({
    rowHeight: 19, labelWidth: 130, indent: 0, size: 10, labelFont: 'Regular', labelColor: 'label',
    valueFont: 'SemiBold', valueColor: 'ink', separator: ':  ', before: 0, after: 0.65,
  }),
  signature: Object.freeze({
    gap: 20, after: 1, partyFont: 'BodyBold', partySize: 9.5, lineFont: 'Regular', lineSize: 9, lineColor: 'muted',
    lineStep: 12, signLineWidth: 160, signLineGap: 40, signLineColor: 'subtle',
  }),
  divider: Object.freeze({ ...DIVIDER_DEFAULTS, color: 'rule' }),
  spacer: Object.freeze({}),
});

const merge = (base, over) => {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
};

/**
 * Deep-merge `over` into `base` (plain objects merge key by key; arrays, null and other values replace).
 * @param {object} base @param {object} [over]
 * @returns {object}
 */
export function mergeStyle(base, over) {
  return merge(base, over);
}

/**
 * Deep-merge a template style over BLOCK_STYLE_DEFAULTS (arrays are replaced).
 * @param {object} [style]
 * @returns {typeof BLOCK_STYLE_DEFAULTS}
 */
export function resolveBlockStyle(style = {}) {
  return merge(BLOCK_STYLE_DEFAULTS, style ?? {});
}

/**
 * A colour value: a palette key (`ink`, `body`…) or a literal colour.
 * @param {Record<string, string>} palette @param {string|undefined} c
 */
export const paletteColour = (palette, c) => (c === undefined || c === null ? c : palette?.[c] ?? c);
