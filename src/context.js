import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { loadWorkspace, clearanceFor } from './workspace/index.js';
import { openDb, migrate, nowIso } from './db/index.js';
import { createRepo } from './db/repo.js';
import { reindexAll } from './services/searchIndex.js';

/** Migration that created `search_index`: documents filed before it are indexed once when it is applied. */
const SEARCH_MIGRATION = 2;

/**
 * Open everything a service needs: config, workspace, migrated database, repo and the acting user.
 * @param {{ home?: string, user?: string, actor?: string, dbFile?: string, env?: Record<string, string|undefined> }} [opts]
 *   home defaults to DOSSIER_HOME (see loadConfig); dbFile defaults to `<home>/data/dossier.sqlite` (may be ':memory:');
 *   actor is the name written to audit rows (default: the user id), e.g. `mcp:<user>` for the MCP server.
 * @returns {{ config: ReturnType<typeof loadConfig>, ws: ReturnType<typeof loadWorkspace>, db: import('./db/index.js').Db,
 *   repo: ReturnType<typeof createRepo>, user: { id: string, clearance: 'Public'|'Internal'|'Confidential'|'Restricted' }, close: () => void }}
 */
export function openContext({ home, user, actor, dbFile, env = process.env } = {}) {
  const base = loadConfig(env);
  const config = { ...base };
  if (home) {
    config.home = resolve(home);
    config.dataDir = join(config.home, 'data');
  }
  if (user) config.user = user;

  // Taken before the load, so a change made while loading is seen by the next refreshWorkspace.
  const fingerprint = workspaceFingerprint(config.home);
  const ws = loadWorkspace(config.home);
  const db = openDb(dbFile ?? join(config.dataDir, 'dossier.sqlite'));
  try {
    const applied = migrate(db);
    const repo = createRepo(db, { actor: actor || config.user });
    syncBrands(repo, ws);
    const ctx = {
      config,
      ws,
      wsFingerprint: fingerprint,
      wsError: null,
      db,
      repo,
      user: { id: config.user, clearance: clearanceFor(ws, config.user) },
      close: () => db.close(),
    };
    if (applied.includes(SEARCH_MIGRATION)) reindexAll(ctx);
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

/** Workspace files whose changes `refreshWorkspace` notices (brand folders are listed, so new brands count too). */
function fingerprintFiles(home) {
  const files = ['workspace.json', 'series.json', 'seeds/entities.json'];
  const brands = join(home, 'brands');
  if (existsSync(brands)) for (const name of readdirSync(brands).sort()) files.push(`brands/${name}/brand.json`);
  return files;
}

/**
 * A cheap signature of the workspace configuration files: path, size and mtime of `workspace.json`, `series.json`,
 * `seeds/entities.json` and every `brands/<id>/brand.json`. No file is read.
 * @param {string} home
 * @returns {string}
 */
export function workspaceFingerprint(home) {
  return fingerprintFiles(home).map((rel) => {
    try {
      const st = statSync(join(home, rel));
      return `${rel}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${rel}:-`;
    }
  }).join('|');
}

/**
 * Reload `ctx.ws` when the workspace files changed on disk since the last load (for long-lived processes such as the
 * MCP server, which do not see saves made by another process). Compares `workspaceFingerprint` first, so an unchanged
 * workspace costs a few `stat` calls. On a change the workspace is loaded and validated; when its `configHash`
 * differs, `ctx.ws` is replaced, `ctx.user.clearance` recomputed and the brand rows synced.
 * A workspace that no longer loads leaves `ctx.ws` as it was and is remembered in `ctx.wsError`: every later call
 * returns that error (without re-reading the files) until the files change and load again. Callers must refuse to work
 * while `error` is set (fail closed: the old clearance may no longer be right).
 * @param {ReturnType<typeof openContext>} ctx
 * @returns {{ reloaded: boolean, changed: boolean, error?: Error }} changed: the files differed from the last check
 */
export function refreshWorkspace(ctx) {
  const home = ctx.ws.home;
  const fingerprint = workspaceFingerprint(home);
  if (fingerprint === ctx.wsFingerprint) return ctx.wsError ? { reloaded: false, changed: false, error: ctx.wsError } : { reloaded: false, changed: false };
  ctx.wsFingerprint = fingerprint;
  let ws;
  try {
    ws = loadWorkspace(home);
  } catch (error) {
    ctx.wsError = error;
    return { reloaded: false, changed: true, error };
  }
  ctx.wsError = null;
  if (ws.configHash === ctx.ws.configHash) return { reloaded: false, changed: true };
  ctx.ws = ws;
  if (ctx.user) ctx.user.clearance = clearanceFor(ws, ctx.user.id);
  syncBrands(ctx.repo, ws);
  return { reloaded: true, changed: true };
}
