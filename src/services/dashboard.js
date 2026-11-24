// Dashboard summary (PLAN-UI `/api/dashboard`): KPIs, a per-day timeline, recent documents, series counters and
// warnings, all over the documents the acting user may see. Read-only.
import { DossierError } from '../errors.js';
import { accessibleLevels } from '../domain/sensitivity.js';
import { missingBrandAssets } from '../workspace/index.js';
import { summaryOf } from './documentQueries.js';
import { listTemplateErrors } from './templates.js';
import { listCounters } from './numbering.js';
import { todayIso } from './fields.js';

/** Range lengths the dashboard accepts, in days. */
export const DASHBOARD_DAYS = Object.freeze([7, 30, 90]);
/** How many recent documents the summary lists. */
export const RECENT_LIMIT = 10;
/** At most this many NUMBER_CONFLICT warnings are listed (kpis.numberConflicts has the full count). */
export const CONFLICT_WARNINGS_MAX = 20;

/**
 * The day a document counts on: its document date, else the local calendar date it was created (created_at is UTC;
 * SQLite's `localtime` uses the process time zone, the same one todayIso uses).
 */
const DAY = "COALESCE(d.doc_date, date(d.created_at, 'localtime'))";
const VISIBLE = 'd.sensitivity IN (SELECT value FROM json_each(:levels))';

const ASSET_LABEL = { 'assets.logo': 'logo', 'assets.seal': 'seal', 'assets.watermark': 'watermark' };
/** Short name of a brandAsset key for a warning: logo, seal, watermark, the signatory id, `<id> (large)`, `<weight> font`. */
const assetLabel = (key) => {
  if (ASSET_LABEL[key]) return ASSET_LABEL[key];
  const [kind, arg] = key.split(':');
  if (kind === 'signature') return arg;
  if (kind === 'signature-large') return `${arg} (large)`;
  return `${arg} font`;
};

function checkDays(days) {
  // Only the canonical spelling: `007`, `7.0` or ` 7` are rejected.
  const n = typeof days === 'string' && /^[1-9]\d*$/.test(days) ? Number(days) : days;
  if (!DASHBOARD_DAYS.includes(n)) {
    throw new DossierError('INVALID_INPUT', `days must be one of ${DASHBOARD_DAYS.join(', ')}`, { days: days ?? null, allowed: [...DASHBOARD_DAYS] });
  }
  return n;
}

/** Local calendar date `offset` days from `base` (a local date), as YYYY-MM-DD. */
const shift = (base, offset) => todayIso(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset));

function invoiced(ctx, params) {
  return ctx.db.prepare(
    `SELECT d.currency, SUM(d.amount_minor) AS amount FROM documents d WHERE ${VISIBLE} AND d.type = 'Invoice' `
    + `AND d.status <> 'Superseded' AND d.amount_minor IS NOT NULL AND ${DAY} BETWEEN :from AND :to `
    + 'GROUP BY d.currency ORDER BY d.currency',
  ).all(params).map((r) => ({ currency: r.currency, amountMinor: Number(r.amount) }));
}

function countInRange(ctx, params) {
  return ctx.db.prepare(`SELECT COUNT(*) AS n FROM documents d WHERE ${VISIBLE} AND ${DAY} BETWEEN :from AND :to`).get(params).n;
}

function warningsOf(ctx, levels) {
  const out = [];
  for (const e of listTemplateErrors(ctx)) {
    out.push({ code: e.code, message: `Template "${e.id}" does not load: ${e.message}`, href: '/templates' });
  }
  const conflicts = ctx.db.prepare(
    `SELECT d.id, d.doc_number, d.number_series FROM documents d WHERE ${VISIBLE} AND d.number_conflict = 1 ORDER BY d.id LIMIT :max`,
  ).all({ levels, max: CONFLICT_WARNINGS_MAX });
  for (const c of conflicts) {
    out.push({
      code: 'NUMBER_CONFLICT',
      message: `${c.id}: number ${c.doc_number} is also used by another document of series ${c.number_series}`,
      href: `/documents/${c.id}`,
    });
  }
  for (const brandId of [...ctx.ws.brands.keys()].sort()) {
    const missing = [...new Set(missingBrandAssets(ctx.ws, brandId).map((m) => assetLabel(m.key)))];
    if (missing.length === 0) continue;
    out.push({
      code: 'BRAND_ASSET_MISSING',
      message: `Brand "${brandId}": ${missing.length} asset ${missing.length === 1 ? 'file' : 'files'} missing (${missing.join(', ')}); placeholders are used`,
      href: `/settings/brands/${encodeURIComponent(brandId)}`,
    });
  }
  return out;
}

/**
 * Dashboard summary over the documents the user may see (sensitivity at or below their clearance): nothing about a
 * document above it reaches any count, sum, list or warning.
 * - `range`: the last `days` local calendar days including today (`from`..`to`, inclusive, YYYY-MM-DD).
 * - A document falls on its `docDate`, else on the local date it was created.
 * - `kpis.documents`: documents falling in the range; `kpis.drafts`: documents in status Draft (all time);
 *   `kpis.invoiced`: per currency, the sum of `amountMinor` (integer minor units) of Invoice documents in the range
 *   that are not Superseded; `kpis.numberConflicts`: documents flagged with a number conflict (all time).
 * - `previous`: `documents` and `invoiced` computed the same way over the `days` days just before the range.
 * - `timeline`: one `{ date, count }` per day of the range, oldest first, zero-filled (sums to `kpis.documents`).
 * - `recent`: the RECENT_LIMIT documents updated last (DocumentSummary).
 * - `counters`: listCounters (series counters are workspace configuration, not document data).
 * - `warnings`: templates that fail to load, the user's documents with a number conflict (at most
 *   CONFLICT_WARNINGS_MAX), and one warning per brand naming its missing asset files; each `{ code, message, href }`.
 * @param {object} ctx
 * @param {{ days?: number|string, now?: Date }} [opts] days: 7, 30 or 90 (default 30), else INVALID_INPUT
 * @returns {object}
 */
export function dashboardSummary(ctx, { days = 30, now = new Date() } = {}) {
  const n = checkDays(days);
  const levels = JSON.stringify(accessibleLevels(ctx.user.clearance));
  const range = { days: n, from: shift(now, -(n - 1)), to: shift(now, 0) };
  const prev = { from: shift(now, -(2 * n - 1)), to: shift(now, -n) };
  const cur = { levels, from: range.from, to: range.to };

  const perDay = new Map(ctx.db.prepare(
    `SELECT ${DAY} AS day, COUNT(*) AS n FROM documents d WHERE ${VISIBLE} AND ${DAY} BETWEEN :from AND :to GROUP BY day`,
  ).all(cur).map((r) => [r.day, r.n]));
  const timeline = [];
  for (let k = n - 1; k >= 0; k--) {
    const date = shift(now, -k);
    timeline.push({ date, count: perDay.get(date) ?? 0 });
  }

  const one = (sql) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM documents d WHERE ${VISIBLE} AND ${sql}`).get({ levels }).n;
  const recent = ctx.db.prepare(`SELECT d.* FROM documents d WHERE ${VISIBLE} ORDER BY d.updated_at DESC, d.id DESC LIMIT :limit`)
    .all({ levels, limit: RECENT_LIMIT }).map((r) => summaryOf(ctx, r));

  return {
    range,
    kpis: {
      documents: timeline.reduce((s, t) => s + t.count, 0),
      drafts: one("d.status = 'Draft'"),
      invoiced: invoiced(ctx, cur),
      numberConflicts: one('d.number_conflict = 1'),
    },
    previous: { ...prev, documents: countInRange(ctx, { levels, ...prev }), invoiced: invoiced(ctx, { levels, ...prev }) },
    timeline,
    recent,
    counters: listCounters(ctx),
    warnings: warningsOf(ctx, levels),
  };
}
