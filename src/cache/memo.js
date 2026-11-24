// In-process memo for read services (docs/PLAN.md B9): values are tagged with the write versions of the tables they
// were built from and flushed whole when another process committed or the workspace configuration changed.
import { Lru } from './lru.js';

/** Dependency name for the loaded workspace configuration (`ctx.ws.configHash`) instead of a table. */
export const WS = 'ws';
/** Default number of memo entries per context. */
export const MEMO_MAX = 2000;

const memos = new WeakMap();

/**
 * @typedef {(<T>(key: string, deps: string[], fn: () => T) => T) & {
 *   flush: () => void, check: () => void, stats: { hits: number, misses: number, flushes: number } }} Memo
 */

/**
 * Create a memo over one context. `memo(key, deps, fn)` returns the cached value of `key` when every dependency still
 * has the version the value was built with, else runs `fn` (synchronous) and caches its result. A dependency is a
 * table name (its `ctx.repo.version(table)`, bumped by every in-process write) or `WS` (`ctx.ws.configHash`).
 * Every call first compares `PRAGMA data_version` (changes when another connection commits) and the workspace
 * `configHash` with the last call and flushes everything when either changed. Inside a transaction the memo is
 * bypassed, because the versions of uncommitted writes are only bumped when the transaction ends. A throwing `fn`
 * caches nothing. Cached values are shared: callers that hand them out must copy them.
 * @param {{ db: { dataVersion: () => number, inTx: () => boolean }, repo: { version: (t: string) => number }, ws: { configHash: string } }} ctx
 * @param {{ max?: number }} [opts] max: entries kept (least recently used evicted), default MEMO_MAX
 * @returns {Memo}
 */
export function createMemo(ctx, { max = MEMO_MAX } = {}) {
  const entries = new Lru(max);
  const stats = { hits: 0, misses: 0, flushes: 0 };
  let dataVersion = null;
  let configHash = null;

  const flush = () => {
    entries.clear();
    stats.flushes++;
  };
  const check = () => {
    const dv = ctx.db.dataVersion();
    const ch = ctx.ws.configHash;
    if (dataVersion !== null && (dv !== dataVersion || ch !== configHash)) flush();
    dataVersion = dv;
    configHash = ch;
  };
  const tagOf = (deps) => deps.map((d) => (d === WS ? `${WS}=${ctx.ws.configHash}` : `${d}=${ctx.repo.version(d)}`)).join('|');

  /** @type {Memo} */
  const memo = (key, deps, fn) => {
    if (ctx.db.inTx()) return fn();
    check();
    const hit = entries.get(key);
    if (hit && hit.tag === tagOf(deps)) {
      stats.hits++;
      return hit.value;
    }
    stats.misses++;
    const value = fn();
    if (value && typeof value.then === 'function') throw new TypeError('memo: fn must be synchronous (it returned a promise)');
    // fn may itself write (registry upserts bump their table): tag with the versions after it ran. fn is synchronous,
    // so no other write of this process can have happened in between.
    entries.set(key, { tag: tagOf(deps), value });
    return value;
  };
  memo.flush = flush;
  memo.check = check;
  memo.stats = stats;
  return memo;
}

/**
 * The memo of a context, created on first use (one per context object).
 * @param {object} ctx
 * @returns {Memo}
 */
export function memoOf(ctx) {
  let m = memos.get(ctx);
  if (!m) memos.set(ctx, (m = createMemo(ctx)));
  return m;
}
