import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';

function withExample(fn) {
  const { dir, cleanup } = tmpDir();
  try {
    const home = initWorkspace(join(dir, 'ws'));
    return fn(home);
  } finally { cleanup(); }
}

test('openContext on the example workspace: db at <home>/data/dossier.sqlite, migrated, brands registered', () => {
  withExample((home) => {
    const ctx = openContext({ home, user: 'demo', env: {} });
    try {
      assert.equal(ctx.config.home, home);
      assert.equal(ctx.config.dataDir, join(home, 'data'));
      assert.ok(existsSync(join(home, 'data', 'dossier.sqlite')));
      assert.equal(ctx.ws.config.defaultBrand, 'acme');
      assert.deepEqual(ctx.user, { id: 'demo', clearance: 'Confidential' });
      assert.equal(ctx.repo.actor, 'demo');
      assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 1);
      const brand = ctx.db.prepare('SELECT * FROM brands').get();
      assert.equal(brand.id, 'acme');
      assert.equal(brand.name, 'Acme Events Private Limited');
      assert.equal(brand.config_hash, ctx.ws.brandHashes.get('acme'));
      const audit = ctx.db.prepare('SELECT * FROM audit_log').all();
      assert.deepEqual(audit.map((a) => [a.action, a.target_kind, a.target_id, a.actor]), [['brand.register', 'brand', 'acme', 'demo']]);
    } finally { ctx.close(); }
  });
});

test('reopening is idempotent; a brand change updates its row and audits before/after', () => {
  withExample((home) => {
    openContext({ home, user: 'demo', env: {} }).close();
    const again = openContext({ home, user: 'demo', env: {} });
    const oldHash = again.db.prepare('SELECT config_hash FROM brands').get().config_hash;
    assert.equal(again.db.prepare('SELECT count(*) AS n FROM audit_log').get().n, 1);
    again.close();

    const file = join(home, 'brands', 'acme', 'brand.json');
    const brand = JSON.parse(readFileSync(file, 'utf8'));
    brand.legalName = 'Acme Events Two Private Limited';
    writeFileSync(file, JSON.stringify(brand));
    const ctx = openContext({ home, user: 'demo', env: {} });
    try {
      const row = ctx.db.prepare('SELECT * FROM brands').get();
      assert.equal(row.name, 'Acme Events Two Private Limited');
      assert.notEqual(row.config_hash, oldHash);
      const last = ctx.db.prepare('SELECT * FROM audit_log ORDER BY id DESC').get();
      assert.equal(last.action, 'brand.update');
      assert.equal(JSON.parse(last.before).name, 'Acme Events Private Limited');
      assert.equal(JSON.parse(last.after).name, 'Acme Events Two Private Limited');
    } finally { ctx.close(); }
  });
});

test('openContext honours dbFile, DOSSIER_HOME/DOSSIER_USER and per-user clearance', () => {
  withExample((home) => {
    const ws = JSON.parse(readFileSync(join(home, 'workspace.json'), 'utf8'));
    ws.users.admin = { clearance: 'Restricted' };
    writeFileSync(join(home, 'workspace.json'), JSON.stringify(ws));

    const mem = openContext({ home, user: 'stranger', dbFile: ':memory:', env: {} });
    try {
      assert.deepEqual(mem.user, { id: 'stranger', clearance: 'Confidential' });
      assert.equal(existsSync(join(home, 'data')), false);
      assert.equal(mem.db.prepare('SELECT count(*) AS n FROM brands').get().n, 1);
    } finally { mem.close(); }

    const env = openContext({ dbFile: ':memory:', env: { DOSSIER_HOME: home, DOSSIER_USER: 'admin' } });
    try {
      assert.equal(env.config.home, home);
      assert.deepEqual(env.user, { id: 'admin', clearance: 'Restricted' });
      assert.equal(env.repo.actor, 'admin');
    } finally { env.close(); }
  });
});

test('openContext surfaces workspace errors without leaving a database behind', () => {
  const { dir, cleanup } = tmpDir();
  try {
    assert.throws(() => openContext({ home: dir, user: 'demo', env: {} }), /workspace\.json/);
    assert.equal(existsSync(join(dir, 'data')), false);
  } finally { cleanup(); }
});
