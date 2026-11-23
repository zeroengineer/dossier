import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { openDb, migrate, MIGRATIONS_DIR } from '../../src/db/index.js';

function mem() {
  const db = openDb(':memory:');
  db.exec('CREATE TABLE t (v INTEGER)');
  return db;
}

test('openDb creates the parent directory and sets WAL, busy_timeout, foreign_keys', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const file = join(dir, 'nested', 'deeper', 'x.sqlite');
    const db = openDb(file);
    assert.ok(existsSync(file));
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.close();
  } finally { cleanup(); }
});

test('openDb(":memory:") works and prepare() caches statements', () => {
  const db = mem();
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('SELECT 1 AS one'), db.prepare('SELECT 1 AS one'));
  db.close();
  db.close(); // idempotent
});

test('withTx commits on success and returns the callback value', () => {
  const db = mem();
  const out = db.withTx(() => { db.prepare('INSERT INTO t VALUES (1)').run(); return 'ok'; });
  assert.equal(out, 'ok');
  assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 1);
  assert.equal(db.inTx(), false);
  db.close();
});

test('withTx rolls back on throw and rethrows', () => {
  const db = mem();
  assert.throws(() => db.withTx(() => {
    db.prepare('INSERT INTO t VALUES (1)').run();
    throw new Error('boom');
  }), /boom/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 0);
  assert.equal(db.inTx(), false);
  assert.equal(db.raw.isTransaction, false);
  db.close();
});

test('nested withTx joins the outer transaction; an inner throw rolls back everything', () => {
  const db = mem();
  db.withTx(() => {
    db.prepare('INSERT INTO t VALUES (1)').run();
    db.withTx(() => db.prepare('INSERT INTO t VALUES (2)').run());
    assert.equal(db.inTx(), true);
  });
  assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 2);

  assert.throws(() => db.withTx(() => {
    db.prepare('INSERT INTO t VALUES (3)').run();
    db.withTx(() => { db.prepare('INSERT INTO t VALUES (4)').run(); throw new Error('inner'); });
  }), /inner/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 2);
  db.close();
});

test('withTx rejects async callbacks and rolls back', () => {
  const db = mem();
  assert.throws(() => db.withTx(async () => {}), /synchronous/);
  assert.equal(db.raw.isTransaction, false);
  db.close();
});

test('afterCommit callbacks run after the outermost commit only; afterRollback on rollback', () => {
  const db = mem();
  const log = [];
  db.withTx(() => {
    db.afterCommit(() => log.push(['commit', db.inTx()]));
    db.afterRollback(() => log.push(['rollback']));
    db.withTx(() => db.afterCommit(() => log.push(['inner-commit', db.inTx()])));
    assert.deepEqual(log, []);
  });
  assert.deepEqual(log, [['commit', false], ['inner-commit', false]]);

  log.length = 0;
  assert.throws(() => db.withTx(() => {
    db.afterCommit(() => log.push('commit'));
    db.afterRollback(() => log.push('rollback'));
    throw new Error('x');
  }));
  assert.deepEqual(log, ['rollback']);

  log.length = 0;
  db.afterCommit(() => log.push('immediate'));
  assert.deepEqual(log, ['immediate']);
  db.close();
});

test('dataVersion changes after a commit from a second connection', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const file = join(dir, 'dv.sqlite');
    const a = openDb(file);
    const b = openDb(file);
    a.exec('CREATE TABLE t (v INTEGER)');
    const v0 = b.dataVersion();
    assert.equal(b.dataVersion(), v0);
    b.prepare('INSERT INTO t VALUES (1)').run(); // own write: no change
    assert.equal(b.dataVersion(), v0);
    a.prepare('INSERT INTO t VALUES (2)').run();
    assert.notEqual(b.dataVersion(), v0);
    a.close();
    b.close();
  } finally { cleanup(); }
});

test('migrate applies files in numeric order once and records them', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const mdir = join(dir, 'migrations');
    mkdirSync(mdir);
    writeFileSync(join(mdir, '010_second.sql'), "INSERT INTO log VALUES ('second');");
    writeFileSync(join(mdir, '002_first.sql'), "CREATE TABLE log (v TEXT); INSERT INTO log VALUES ('first');");
    writeFileSync(join(mdir, 'notes.txt'), 'ignored');
    const db = openDb(':memory:');
    assert.deepEqual(migrate(db, mdir), [2, 10]);
    assert.deepEqual(migrate(db, mdir), []);
    assert.deepEqual(db.prepare('SELECT v FROM log').all().map((r) => r.v), ['first', 'second']);
    const rows = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all();
    assert.deepEqual(rows.map((r) => [r.version, r.name]), [[2, '002_first.sql'], [10, '010_second.sql']]);
    assert.match(rows[0].applied_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    db.close();
  } finally { cleanup(); }
});

test('a failing migration rolls back and is not recorded', () => {
  const { dir, cleanup } = tmpDir();
  try {
    writeFileSync(join(dir, '001_bad.sql'), 'CREATE TABLE ok (v INTEGER); THIS IS NOT SQL;');
    const db = openDb(':memory:');
    assert.throws(() => migrate(db, dir));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ok'").get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 0);
    db.close();
  } finally { cleanup(); }
});

test('shipped migrations are idempotent', () => {
  const db = openDb(':memory:');
  assert.deepEqual(migrate(db), [1]);
  assert.deepEqual(migrate(db), []);
  assert.ok(existsSync(join(MIGRATIONS_DIR, '001_core.sql')));
  db.close();
});
