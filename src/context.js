import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { loadWorkspace, clearanceFor } from './workspace/index.js';
import { openDb, migrate, nowIso } from './db/index.js';
import { createRepo } from './db/repo.js';

/**
 * Open everything a service needs: config, workspace, migrated database, repo and the acting user.
 * @param {{ home?: string, user?: string, dbFile?: string, env?: Record<string, string|undefined> }} [opts]
 *   home defaults to DOSSIER_HOME (see loadConfig); dbFile defaults to `<home>/data/dossier.sqlite` (may be ':memory:').
 * @returns {{ config: ReturnType<typeof loadConfig>, ws: ReturnType<typeof loadWorkspace>, db: import('./db/index.js').Db,
 *   repo: ReturnType<typeof createRepo>, user: { id: string, clearance: 'Public'|'Internal'|'Confidential'|'Restricted' }, close: () => void }}
 */
export function openContext({ home, user, dbFile, env = process.env } = {}) {
  const base = loadConfig(env);
  const config = { ...base };
  if (home) {
    config.home = resolve(home);
    config.dataDir = join(config.home, 'data');
  }
  if (user) config.user = user;

  const ws = loadWorkspace(config.home);
  const db = openDb(dbFile ?? join(config.dataDir, 'dossier.sqlite'));
  try {
    migrate(db);
    const repo = createRepo(db, { actor: config.user });
    syncBrands(repo, ws);
    const ctx = {
      config,
      ws,
      db,
      repo,
      user: { id: config.user, clearance: clearanceFor(ws, config.user) },
      close: () => db.close(),
    };
    return ctx;
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * Upsert one `brands` row per workspace brand (id, legal name, config hash). Rows of brands no longer in the
 * workspace are kept, because documents may still reference them. Only changed rows are written and audited.
 * @param {ReturnType<typeof createRepo>} repo
 * @param {ReturnType<typeof loadWorkspace>} ws
 */
export function syncBrands(repo, ws) {
  const { db } = repo;
  repo.tx(() => {
    for (const [id, brand] of ws.brands) {
      const hash = ws.brandHashes.get(id);
      const before = db.prepare('SELECT id, name, config_hash FROM brands WHERE id = ?').get(id);
      if (before && before.name === brand.legalName && before.config_hash === hash) continue;
      const after = { id, name: brand.legalName, config_hash: hash };
      db.prepare(
        'INSERT INTO brands (id, name, config_hash, loaded_at) VALUES (?, ?, ?, ?) '
        + 'ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_hash = excluded.config_hash, loaded_at = excluded.loaded_at',
      ).run(id, after.name, hash, nowIso());
      repo.audit(before ? 'brand.update' : 'brand.register', 'brand', id, before ? { ...before } : null, after);
      repo.bump('brands');
      repo.emitAfterCommit('brand:changed', { id });
    }
  });
}
