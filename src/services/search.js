import { DossierError } from '../errors.js';
import { STATUSES } from '../domain/status.js';
import { accessibleLevels } from '../domain/sensitivity.js';
import { summaryOf } from './documentQueries.js';
import { findEntities, normaliseName } from './entities.js';
import { expandRelated } from './searchExpand.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);

const MAX_LIMIT = 200;
const ENTITY_LIMIT = 10;
const OPTIONS = ['q', 'types', 'status', 'partyId', 'from', 'to', 'limit', 'expand'];
/** bm25 column weights: doc_id (unindexed), title, number, parties, body. */
const BM25 = 'bm25(search_index, 0.0, 10.0, 10.0, 5.0, 1.0)';
const METADATA_COLUMNS = '{title number parties}';
const BODY_COLUMN = 4;

/**
 * @typedef {import('./documentQueries.js').DocumentSummary} DocumentSummary
 * @typedef {{ document: DocumentSummary, score: number, match: 'number'|'metadata'|'text', snippet: string|null }} SearchHit
 * @typedef {{ document: DocumentSummary, via: { kind: 'entity'|'document', relation: string, from: string|number } }} RelatedDocument
 */

/**
 * Search documents by number, metadata (title, type, number, party names and aliases) and extracted text, and
 * expand one hop (docs/PLAN.md B6).
 *
 * Hits are ordered: exact document number (or id) match, number prefix match, metadata match, text match; within
 * a group by relevance (`score`, higher is better: negated FTS5 bm25, 0 for a number match without a text match).
 * Text hits carry an FTS5 snippet of the extracted text with matched terms in `[` `]`. The query is split on
 * whitespace and every word is quoted, so FTS operators are ordinary words; all words must match.
 *
 * Entities whose name or alias contains the query are listed in `entities`. With `expand`, `related` holds the
 * documents linked to a hit by any document relation (either direction) and the documents of each matched entity
 * as party, signatory or named, each once, never repeating a hit. Every document returned is within the user's
 * clearance and passes the filters.
 * @param {object} ctx
 * @param {{ q: string, types?: string|string[], status?: string|string[], partyId?: number, from?: string,
 *   to?: string, limit?: number, expand?: boolean }} opts `from`/`to` bound docDate (inclusive); limit 1..200
 *   (default 20) applies to hits and to related separately
 * @returns {{ hits: SearchHit[], related: RelatedDocument[], entities: ReturnType<typeof findEntities> }}
 */
export function search(ctx, opts = {}) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) throw invalid('search needs an options object');
  for (const key of Object.keys(opts)) {
    if (!OPTIONS.includes(key)) throw invalid(`Unknown search option "${key}" (expected one of ${OPTIONS.join(', ')})`, { option: key });
  }
  const { q, limit = 20, expand = true } = opts;
  if (typeof q !== 'string') throw invalid('q must be a string', { q });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw invalid(`limit must be an integer from 1 to ${MAX_LIMIT}`, { limit });
  if (typeof expand !== 'boolean') throw invalid('expand must be a boolean', { expand });
  const filter = buildFilter(ctx, opts);

  const text = q.replace(/\p{Cc}/gu, ' ').trim();
  if (text === '') return { hits: [], related: [], entities: [] };

  const hits = rankHits([...numberMatches(ctx, text, filter, limit), ...ftsMatches(ctx, text, filter, limit)], limit);
  // findEntities lists everything for an empty key, so a punctuation-only query must not reach it.
  const entities = normaliseName(text) === '' ? [] : findEntities(ctx, { q: text, limit: ENTITY_LIMIT });
  const related = expand
    ? expandRelated(ctx, { hitIds: hits.map((h) => h.row.id), entityIds: entities.map((e) => e.id), filter, limit })
    : [];
  return {
    hits: hits.map((h) => ({ document: summaryOf(ctx, h.row), score: h.score, match: h.match, snippet: h.snippet })),
    related: related.map((r) => ({ document: summaryOf(ctx, r.row), via: r.via })),
    entities,
  };
}

// ---------- filters ----------

/** Sensitivity plus the caller's filters as SQL over `d` (documents), with only the parameters it uses. */
function buildFilter(ctx, opts) {
  const where = ['d.sensitivity IN (SELECT value FROM json_each(:levels))'];
  const params = { levels: JSON.stringify(accessibleLevels(ctx.user.clearance)) };
  const types = listOf(opts.types, 'types');
  if (types) {
    where.push('d.type IN (SELECT value FROM json_each(:types))');
    params.types = JSON.stringify(types);
  }
  const status = listOf(opts.status, 'status');
  if (status) {
    for (const s of status) if (!STATUSES.includes(s)) throw invalid(`Unknown status "${s}" (expected one of ${STATUSES.join(', ')})`, { status: s });
    where.push('d.status IN (SELECT value FROM json_each(:status))');
    params.status = JSON.stringify(status);
  }
  if (opts.partyId !== undefined && opts.partyId !== null) {
    const n = typeof opts.partyId === 'string' && /^\d+$/.test(opts.partyId) ? Number(opts.partyId) : opts.partyId;
    if (!Number.isSafeInteger(n) || n <= 0) throw invalid('partyId must be a positive integer', { partyId: opts.partyId });
    where.push('d.party_id = :partyId');
    params.partyId = n;
  }
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    const v = opts[key];
    if (v === undefined || v === null) continue;
    if (!isDate(v)) throw invalid(`${key} must be a date YYYY-MM-DD`, { [key]: v });
    where.push(`d.doc_date ${op} :${key}`);
    params[key] = v;
  }
  return { sql: where.join(' AND '), params };
}

function listOf(v, what) {
  if (v === undefined || v === null) return null;
  const list = Array.isArray(v) ? v : [v];
  if (list.length === 0 || list.some((x) => typeof x !== 'string' || x === '')) throw invalid(`${what} must be a non-empty string or list of strings`, { [what]: v });
  return list;
}

function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

// ---------- matching ----------

/** Exact (case-insensitive) document number or id matches, then number prefix matches. */
function numberMatches(ctx, text, filter, limit) {
  const exact = ctx.db.prepare(
    `SELECT d.* FROM documents d WHERE (lower(d.doc_number) = lower(:q) OR d.id = upper(:q)) AND ${filter.sql} ORDER BY d.id LIMIT :limit`,
  ).all({ ...filter.params, q: text, limit }).map((row) => ({ row, tier: 0 }));
  // A prefix needs two characters and no spaces, so a one-letter or multi-word query is not read as a number.
  if (text.length < 2 || /\s/u.test(text)) return exact;
  const like = `${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const prefix = ctx.db.prepare(
    `SELECT d.* FROM documents d WHERE lower(d.doc_number) LIKE :like ESCAPE '\\' AND lower(d.doc_number) <> lower(:q) AND ${filter.sql} `
    + 'ORDER BY d.doc_number, d.id LIMIT :limit',
  ).all({ ...filter.params, q: text, like, limit }).map((row) => ({ row, tier: 1 }));
  return [...exact, ...prefix];
}

/**
 * FTS5 query for user text: every whitespace-separated word quoted as a phrase (inner `"` dropped), so FTS syntax
 * (`OR`, `NEAR`, `*`, `:`, parentheses) is matched as plain text. Words without letters or digits are dropped.
 * @param {string} text
 * @returns {string|null} null when nothing searchable is left
 */
export function ftsQuery(text) {
  const words = text.split(/\s+/u).map((w) => w.replace(/"/g, '')).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length ? words.map((w) => `"${w}"`).join(' ') : null;
}

/** Metadata matches (tier 2) and text-only matches (tier 3), each ordered by bm25. */
function ftsMatches(ctx, text, filter, limit) {
  const expr = ftsQuery(text);
  if (!expr) return [];
  const run = (match, n) => ctx.db.prepare(
    `SELECT d.*, ${BM25} AS fts_rank, snippet(search_index, ${BODY_COLUMN}, '[', ']', '…', 12) AS fts_snippet `
    + 'FROM search_index JOIN documents d ON d.id = search_index.doc_id '
    + `WHERE search_index MATCH :match AND ${filter.sql} ORDER BY fts_rank, d.id LIMIT :n`,
  ).all({ ...filter.params, match, n });
  const meta = run(`${METADATA_COLUMNS} : (${expr})`, limit);
  const metaIds = new Set(meta.map((r) => r.id));
  // Fetch enough rows that `limit` text-only rows remain after removing metadata matches.
  const all = run(expr, limit + meta.length);
  const scores = new Map(all.map((r) => [r.id, r]));
  return [
    ...meta.map((row) => ({ row, tier: 2, rank: scores.get(row.id)?.fts_rank ?? row.fts_rank })),
    ...all.filter((r) => !metaIds.has(r.id)).map((row) => ({ row, tier: 3, rank: row.fts_rank, snippet: row.fts_snippet })),
  ];
}

const MATCH_OF_TIER = ['number', 'number', 'metadata', 'text'];

/** Merge candidates: best tier per document, FTS relevance attached to number matches, ordered, cut to `limit`. */
function rankHits(candidates, limit) {
  const best = new Map();
  const rank = new Map();
  for (const c of candidates) {
    if (c.rank !== undefined && !rank.has(c.row.id)) rank.set(c.row.id, c.rank);
    const prev = best.get(c.row.id);
    if (!prev || c.tier < prev.tier) best.set(c.row.id, c);
  }
  const score = (id) => (rank.has(id) ? round(-rank.get(id)) : 0);
  return [...best.values()]
    .map((c) => ({ row: c.row, tier: c.tier, score: score(c.row.id), match: MATCH_OF_TIER[c.tier], snippet: c.tier === 3 ? c.snippet ?? null : null }))
    .sort((a, b) => a.tier - b.tier || b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, limit);
}

const round = (n) => Math.round(n * 1e6) / 1e6 + 0;
