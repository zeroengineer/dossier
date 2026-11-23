import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../../src/db/index.js';
import { createRepo, formatDocId } from '../../src/db/repo.js';
import { canonicalKey } from '../../src/domain/canonical.js';

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, repo: createRepo(db, { actor: 'demo' }) };
}
const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

test('createRepo requires an actor', () => {
  const db = openDb(':memory:');
  assert.throws(() => createRepo(db, {}), /actor/);
  db.close();
});

test('audit writes a row with ISO timestamp, actor and JSON before/after', () => {
  const { db, repo } = setup();
  const id = repo.audit('document.create', 'document', 'DOC-000001', null, { title: 'X', n: 1 });
  repo.audit('setting.set', 'setting', null);
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].actor, 'demo');
  assert.equal(rows[0].action, 'document.create');
  assert.equal(rows[0].target_kind, 'document');
  assert.equal(rows[0].target_id, 'DOC-000001');
  assert.equal(rows[0].before, null);
  assert.deepEqual(JSON.parse(rows[0].after), { title: 'X', n: 1 });
  assert.match(rows[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(rows[1].target_id, null);
  db.close();
});

test('audit rows roll back with their transaction', () => {
  const { db, repo } = setup();
  assert.throws(() => repo.tx(() => { repo.audit('x', 'k', 1); throw new Error('no'); }), /no/);
  assert.equal(count(db, 'audit_log'), 0);
  db.close();
});

test('events queued in tx fire only after commit, in order, and never on rollback', () => {
  const { db, repo } = setup();
  const seen = [];
  repo.events.on('document:changed', (p) => seen.push({ ...p, inTx: db.inTx(), rows: count(db, 'audit_log') }));
  const out = repo.tx((r) => {
    assert.equal(r, repo);
    r.audit('a', 'document', 'DOC-000001');
    r.emitAfterCommit('document:changed', { id: 'DOC-000001' });
    r.tx(() => r.emitAfterCommit('document:changed', { id: 'DOC-000002' }));
    assert.deepEqual(seen, []);
    return 42;
  });
  assert.equal(out, 42);
  assert.deepEqual(seen, [{ id: 'DOC-000001', inTx: false, rows: 1 }, { id: 'DOC-000002', inTx: false, rows: 1 }]);

  seen.length = 0;
  assert.throws(() => repo.tx(() => { repo.emitAfterCommit('document:changed', { id: 'X' }); throw new Error('rollback'); }));
  assert.deepEqual(seen, []);

  repo.emitAfterCommit('document:changed', { id: 'now' });
  assert.equal(seen[0].id, 'now');
  db.close();
});

test('events wait for an outer db.withTx opened outside the repo', () => {
  const { db, repo } = setup();
  const seen = [];
  repo.events.on('e', (p) => seen.push(p));
  db.withTx(() => {
    repo.tx(() => repo.emitAfterCommit('e', 1));
    assert.deepEqual(seen, []);
  });
  assert.deepEqual(seen, [1]);
  db.close();
});

test('bump/version count writes per table; in a tx they apply when it ends', () => {
  const { db, repo } = setup();
  assert.equal(repo.version('entities'), 0);
  repo.bump('entities');
  assert.equal(repo.version('entities'), 1);
  repo.tx(() => {
    repo.bump('entities');
    repo.bump('documents');
    assert.equal(repo.version('entities'), 1);
  });
  assert.equal(repo.version('entities'), 2);
  assert.equal(repo.version('documents'), 1);
  assert.throws(() => repo.tx(() => { repo.bump('entities'); throw new Error('x'); }));
  assert.equal(repo.version('entities'), 3, 'rollback still invalidates');
  db.close();
});

test('nextDocumentId hands out DOC-000001, DOC-000002 … from the doc-id sequence, inside a tx only', () => {
  const { db, repo } = setup();
  assert.throws(() => repo.nextDocumentId(), /inside repo.tx/);
  assert.equal(repo.tx(() => repo.nextDocumentId()), 'DOC-000001');
  assert.equal(repo.tx(() => repo.nextDocumentId()), 'DOC-000002');
  assert.throws(() => repo.tx(() => { repo.nextDocumentId(); throw new Error('x'); }));
  assert.equal(repo.tx(() => repo.nextDocumentId()), 'DOC-000003');
  assert.equal(db.prepare("SELECT next FROM sequences WHERE scope_key = 'doc-id'").get().next, 4);
  assert.equal(repo.tx(() => repo.nextSequence('acme|2026', 131)), 131);
  assert.equal(repo.tx(() => repo.nextSequence('acme|2026', 131)), 132);
  assert.equal(formatDocId(1234567), 'DOC-1234567');
  db.close();
});

test('canonicalKey folds case, spacing and punctuation', () => {
  assert.equal(canonicalKey('  Acme  Events, Pvt. Ltd '), 'acme events pvt ltd');
  assert.equal(canonicalKey('ACME EVENTS PVT LTD'), 'acme events pvt ltd');
  assert.equal(canonicalKey('Ｅxample'), 'example');
  assert.equal(canonicalKey('Example Fest 2026 - Sample College'), 'example fest 2026 - sample college');
});

test('a throwing event listener does not fail the write; its error is emitted as listenerError', () => {
  const { db, repo } = setup();
  const errors = [];
  repo.events.on('listenerError', (err) => errors.push(err.message));
  repo.events.on('document:changed', () => { throw new Error('listener broke'); });
  const id = repo.tx(() => {
    const docId = repo.nextDocumentId();
    db.prepare("INSERT INTO documents (id, type) VALUES (?, 'invoice')").run(docId);
    repo.audit('document.create', 'document', docId);
    repo.emitAfterCommit('document:changed', { id: docId });
    return docId;
  });
  assert.equal(id, 'DOC-000001');
  assert.equal(count(db, 'documents'), 1);
  assert.equal(count(db, 'audit_log'), 1);
  assert.deepEqual(errors, ['listener broke']);
  // Outside a tx as well.
  repo.emitAfterCommit('document:changed', { id: 'x' });
  assert.deepEqual(errors, ['listener broke', 'listener broke']);
  assert.equal(repo.tx(() => repo.nextDocumentId()), 'DOC-000002');
  db.close();
});
