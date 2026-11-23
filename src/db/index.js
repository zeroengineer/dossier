import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory holding the shipped `NNN_*.sql` migrations. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/** Current time as an ISO-8601 UTC string (the format of every timestamp column). */
export const nowIso = () => new Date().toISOString();

/**
 * @typedef {object} Db
 * @property {DatabaseSync} raw underlying node:sqlite handle
 * @property {string} file
 * @property {(sql: string) => import('node:sqlite').StatementSync} prepare cached prepared statement
 * @property {(sql: string) => void} exec
 * @property {<T>(fn: () => T) => T} withTx run fn in BEGIN IMMEDIATE / COMMIT; nested calls join the outer transaction
 * @property {() => boolean} inTx
 * @property {(cb: () => void) => void} afterCommit run cb after the outermost transaction commits (now, if none is open)
 * @property {(cb: () => void) => void} afterRollback run cb if the outermost transaction rolls back (dropped if none is open)
 * @property {() => number} dataVersion `PRAGMA data_version`; changes when another connection commits
 * @property {(err: unknown) => void} onCallbackError receives errors thrown by after-commit/after-rollback callbacks (default: stderr); never rethrown
 * @property {() => void} close idempotent
 */

/**
 * Open (creating if needed) a SQLite database with the pragmas Dossier relies on.
 * @param {string} file path, or ':memory:'
 * @returns {Db}
 */
export function openDb(file) {
  const memory = file === ':memory:';
  if (!memory) {
    file = resolve(file);
    mkdirSync(dirname(file), { recursive: true });
  }
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA busy_timeout = 5000');
  if (!memory) raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');

  const cache = new Map();
  let depth = 0;
  let closed = false;
  let onCommit = [];
  let onRollback = [];

  // Callbacks run after the transaction has ended: their errors must never reach the writer, whose write is
  // already committed (or already rolled back). They go to db.onCallbackError instead.
  const runAll = (cbs) => {
    for (const cb of cbs) {
      try { cb(); } catch (err) { reportCallbackError(err); }
    }
  };
  const reportCallbackError = (err) => {
    try { db.onCallbackError(err); } catch (inner) { logCallbackError(inner); }
  };

  /** @type {Db} */
  const db = {
    raw,
    file,
    onCallbackError: logCallbackError,
    prepare(sql) {
      let stmt = cache.get(sql);
      if (!stmt) {
        stmt = raw.prepare(sql);
        cache.set(sql, stmt);
      }
      return stmt;
    },
    exec(sql) { raw.exec(sql); },
    inTx: () => depth > 0,
    withTx(fn) {
      if (depth > 0) {
        depth++;
        try { return checkSync(fn()); } finally { depth--; }
      }
      raw.exec('BEGIN IMMEDIATE');
      depth = 1;
      let result;
      let cbs = [];
      try {
        result = checkSync(fn());
        raw.exec('COMMIT');
        cbs = onCommit;
      } catch (err) {
        cbs = onRollback;
        try {
          raw.exec('ROLLBACK');
        } catch (rbErr) {
          // SQLite may already have rolled back (e.g. after some errors); anything else is worth surfacing.
          if (!/no transaction is active/i.test(String(rbErr?.message))) logCallbackError(rbErr);
        }
        throw err;
      } finally {
        onCommit = [];
        onRollback = [];
        depth = 0;
        runAll(cbs);
      }
      return result;
    },
    afterCommit(cb) {
      if (depth > 0) onCommit.push(cb);
      else runAll([cb]);
    },
    afterRollback(cb) {
      if (depth > 0) onRollback.push(cb);
    },
    dataVersion: () => raw.prepare('PRAGMA data_version').get().data_version,
    close() {
      if (closed) return;
      closed = true;
      cache.clear();
      raw.close();
    },
  };
  return db;
}

/** Default sink for errors thrown by after-commit / after-rollback callbacks. */
function logCallbackError(err) {
  process.stderr.write(`dossier: post-transaction callback failed: ${err?.stack ?? err}\n`);
}

/** withTx callbacks must be synchronous: node:sqlite is sync and an awaited gap would leak the transaction. */
function checkSync(value) {
  if (value && typeof value.then === 'function') {
    throw new TypeError('withTx: the callback must be synchronous (it returned a promise)');
  }
  return value;
}

/**
 * Apply pending `NNN_*.sql` migrations from `dir` in numeric order, each in its own transaction,
 * recording them in `schema_migrations(version, applied_at)`. Safe to call repeatedly.
 * @param {Db} db
 * @param {string} [dir]
 * @returns {number[]} versions applied by this call
 */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const files = readdirSync(dir)
    .map((name) => ({ name, m: /^(\d{3,})_[\w-]+\.sql$/.exec(name) }))
    .filter((f) => f.m)
    .map((f) => ({ name: f.name, version: Number(f.m[1]) }))
    .sort((a, b) => a.version - b.version);
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.version)) throw new Error(`migrate: duplicate migration version ${f.version} in ${dir}`);
    seen.add(f.version);
  }
  const applied = [];
  for (const f of files) {
    db.withTx(() => {
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(f.version)) return;
      db.exec(readFileSync(join(dir, f.name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(f.version, f.name, nowIso());
      applied.push(f.version);
    });
  }
  return applied;
}
