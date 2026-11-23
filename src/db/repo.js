import { EventEmitter } from 'node:events';
import { nowIso } from './index.js';

/** Sequence row that hands out document ids. */
export const DOC_ID_SEQUENCE = 'doc-id';

/**
 * Format a document id counter value as `DOC-000001` (zero-padded to 6 digits; longer numbers keep all digits).
 * @param {number} n
 * @returns {string}
 */
export const formatDocId = (n) => `DOC-${String(n).padStart(6, '0')}`;

/**
 * The single write gateway over a Db: transactions, audit rows, per-table write versions and post-commit events.
 * @param {import('./index.js').Db} db
 * @param {{ actor: string }} opts
 */
export function createRepo(db, { actor }) {
  if (!actor) throw new Error('createRepo: actor is required');
  const events = new EventEmitter();
  const versions = new Map();

  // Post-commit listener errors never reach the writer (the write is committed). They are emitted as
  // 'listenerError' when someone listens, otherwise passed to the db's previous sink (stderr by default).
  const fallback = db.onCallbackError;
  db.onCallbackError = (err) => {
    if (events.listenerCount('listenerError') > 0) events.emit('listenerError', err);
    else fallback(err);
  };

  const repo = {
    db,
    actor,
    events,

    /**
     * Run fn(repo) in a transaction (joining an open one). Events queued with emitAfterCommit fire only after commit.
     * @template T
     * @param {(repo: object) => T} fn
     * @returns {T}
     */
    tx(fn) {
      return db.withTx(() => fn(repo));
    },

    /**
     * Append an audit row (part of the current transaction, if any).
     * @param {string} action e.g. 'document.create'
     * @param {string} targetKind e.g. 'document'
     * @param {string|number|null} targetId
     * @param {unknown} [before] JSON-serialisable state before the write (null/undefined -> NULL)
     * @param {unknown} [after] JSON-serialisable state after the write
     * @returns {number} audit row id
     */
    audit(action, targetKind, targetId, before = null, after = null) {
      const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
      const r = db.prepare(
        'INSERT INTO audit_log (at, actor, action, target_kind, target_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(nowIso(), actor, action, targetKind, targetId === null || targetId === undefined ? null : String(targetId), json(before), json(after));
      return Number(r.lastInsertRowid);
    },

    /**
     * Mark an in-process write to `table`. Inside a transaction the bump is applied when it ends (commit or rollback,
     * so a memo built from uncommitted rows is never trusted).
     * @param {string} table
     */
    bump(table) {
      const apply = () => versions.set(table, (versions.get(table) ?? 0) + 1);
      if (db.inTx()) {
        db.afterCommit(apply);
        db.afterRollback(apply);
      } else apply();
    },

    /**
     * In-process write version of a table (0 until the first bump).
     * @param {string} table
     * @returns {number}
     */
    version(table) {
      return versions.get(table) ?? 0;
    },

    /**
     * Emit `event` on repo.events after the current transaction commits (immediately when none is open).
     * Dropped if the transaction rolls back. A throwing listener never fails the write: its error is emitted as
     * 'listenerError' (or logged to stderr when nobody listens).
     * @param {string} event
     * @param {unknown} payload
     */
    emitAfterCommit(event, payload) {
      db.afterCommit(() => events.emit(event, payload));
    },

    /**
     * Take the next value of a counter in `sequences`, creating it at `start`. Must run inside a transaction.
     * @param {string} scopeKey
     * @param {number} [start]
     * @returns {number}
     */
    nextSequence(scopeKey, start = 1) {
      if (!db.inTx()) throw new Error('nextSequence must run inside repo.tx()');
      const row = db.prepare(
        'INSERT INTO sequences (scope_key, next) VALUES (?, ? + 1) ON CONFLICT(scope_key) DO UPDATE SET next = next + 1 RETURNING next - 1 AS value',
      ).get(scopeKey, start);
      return row.value;
    },

    /**
     * Allocate the next document id (`DOC-000001`, …) from the `doc-id` sequence. Must run inside a transaction.
     * @returns {string}
     */
    nextDocumentId() {
      return formatDocId(repo.nextSequence(DOC_ID_SEQUENCE, 1));
    },
  };
  return repo;
}
