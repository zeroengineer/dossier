import { DossierError } from '../errors.js';
import { formatNumber, parseNumber, scopeKey } from '../domain/numbering.js';

/**
 * Numbering service: allocates document numbers from the series in `series.json`, with counters in `sequences`.
 * Counter rows are keyed by `scopeKey` (see `src/domain/numbering.js`); series that share a `counter` share rows.
 */

/** @typedef {{ date?: string|Date, brandId?: string, client?: string, code?: string }} NumberOptions */

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function getSeries(ctx, seriesId) {
  const series = ctx.ws.series.get(seriesId);
  if (!series) throw new DossierError('SERIES_UNKNOWN', `No numbering series "${seriesId}" in series.json`, { seriesId });
  return series;
}

/** First value of a series' counter: the `start` of the series that owns the counter. */
const counterStart = (ctx, series) => (ctx.ws.series.get(series.counter) ?? series).start ?? 1;

function brandOf(ctx, brandId) {
  const id = brandId ?? ctx.ws.config.defaultBrand;
  if (!id || !ctx.ws.brands.has(id)) throw new DossierError('BRAND_NOT_FOUND', `No brand "${id}" in the workspace`, { brandId: id ?? null });
  return id;
}

function numberVars(ctx, opts = {}) {
  if (opts === null || typeof opts !== 'object') throw new DossierError('INVALID_INPUT', 'Number options must be an object');
  const { date = today(), brandId, client, code } = opts;
  return { date, brand: brandOf(ctx, brandId), client, code };
}

const readNext = (ctx, key) => ctx.db.prepare('SELECT next FROM sequences WHERE scope_key = ?').get(key)?.next;

/**
 * Allocate the next number of a series. Runs in the caller's transaction (`ctx.repo.tx` joins it), or in its own.
 * @param {object} ctx
 * @param {string} seriesId
 * @param {NumberOptions} [opts] date defaults to today (local), brandId to the workspace default brand
 * @returns {{ number: string, seq: number, scopeKey: string }}
 */
export function allocateNumber(ctx, seriesId, opts = {}) {
  const series = getSeries(ctx, seriesId);
  const vars = numberVars(ctx, opts);
  const key = scopeKey(series, vars);
  formatNumber(series.pattern, { ...vars, seq: 0 }); // reports a missing {CLIENT}/{CODE} before a value is taken
  return ctx.repo.tx((repo) => {
    const seq = repo.nextSequence(key, counterStart(ctx, series));
    return { number: formatNumber(series.pattern, { ...vars, seq }), seq, scopeKey: key };
  });
}

/**
 * The number `allocateNumber` would hand out now, without taking it.
 * @param {object} ctx
 * @param {string} seriesId
 * @param {NumberOptions} [opts]
 * @returns {{ number: string, seq: number, scopeKey: string }}
 */
export function peekNumber(ctx, seriesId, opts = {}) {
  const series = getSeries(ctx, seriesId);
  const vars = numberVars(ctx, opts);
  const key = scopeKey(series, vars);
  const seq = readNext(ctx, key) ?? counterStart(ctx, series);
  return { number: formatNumber(series.pattern, { ...vars, seq }), seq, scopeKey: key };
}

/**
 * Move a counter forward so the next allocation is at least `nextValue`. Never moves a counter back.
 * @param {object} ctx
 * @param {string} seriesId
 * @param {{ date?: string|Date, year?: number, fy?: string, brandId?: string, brand?: string, client?: string }} vars
 *   the scope to seed (`brand`, e.g. parsed from a `{BRAND}` token, is used as given; `brandId` must be a workspace brand)
 * @param {number} nextValue
 * @returns {{ scopeKey: string, next: number, moved: boolean }}
 */
export function seedCounter(ctx, seriesId, vars = {}, nextValue) {
  const series = getSeries(ctx, seriesId);
  if (vars === null || typeof vars !== 'object') throw new DossierError('INVALID_INPUT', 'Counter vars must be an object');
  if (!Number.isSafeInteger(nextValue) || nextValue < 0) {
    throw new DossierError('INVALID_INPUT', 'nextValue must be a non-negative integer', { nextValue });
  }
  const { brandId, ...rest } = vars;
  const scoped = { ...rest, brand: rest.brand ?? brandOf(ctx, brandId) };
  const key = scopeKey(series, scoped);
  const start = counterStart(ctx, series);
  return ctx.repo.tx((repo) => {
    const before = readNext(ctx, key) ?? start;
    const target = Math.max(nextValue, start);
    const next = ctx.db.prepare(
      'INSERT INTO sequences (scope_key, next) VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET next = max(next, excluded.next) RETURNING next',
    ).get(key, target).next;
    const moved = next !== before;
    if (moved) repo.audit('sequence.seed', 'sequence', key, { next: before }, { next, seriesId });
    return { scopeKey: key, next, moved };
  });
}

/**
 * Register a number issued outside Dossier (e.g. a legacy document): parse it with the series pattern and seed the
 * counter past it.
 * @param {object} ctx
 * @param {string} seriesId
 * @param {string} number
 * @param {{ brandId?: string, date?: string|Date }} [opts] brand when the pattern has no `{BRAND}`; date when the
 *   pattern has no year token but the scope needs a year
 * @returns {{ scopeKey: string, seq: number, next: number, moved: boolean, vars: object }}
 */
export function registerExisting(ctx, seriesId, number, opts = {}) {
  const series = getSeries(ctx, seriesId);
  const parsed = parseNumber(series.pattern, number);
  if (!parsed) {
    throw new DossierError('NUMBER_UNPARSEABLE', `"${number}" does not match the pattern ${series.pattern} of series "${seriesId}"`,
      { seriesId, number: String(number), pattern: series.pattern });
  }
  const vars = { ...(opts.date !== undefined ? { date: opts.date } : {}), ...parsed };
  if (!parsed.brand) vars.brandId = opts.brandId;
  const seeded = seedCounter(ctx, seriesId, vars, parsed.seq + 1);
  return { ...seeded, seq: parsed.seq, vars: parsed };
}
