import { userInfo } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

/**
 * Process-level configuration from the environment.
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [cwd]
 * @returns {{ home: string, dataDir: string, user: string, port: number, templateDirs: string[], renderCacheMb: number }}
 *   `templateDirs` (DOSSIER_TEMPLATE_DIRS, separated like PATH) are extra template folders loaded after the built-ins and
 *   before the workspace's `templates/`. `renderCacheMb` (DOSSIER_RENDER_CACHE_MB, default 500) bounds the disk render
 *   cache; 0 turns it off.
 */
export function loadConfig(env = process.env, cwd = process.cwd()) {
  const home = resolve(cwd, env.DOSSIER_HOME || 'workspace');
  return {
    home,
    dataDir: join(home, 'data'),
    user: env.DOSSIER_USER || userInfo().username,
    port: Number(env.PORT) || 4400,
    templateDirs: (env.DOSSIER_TEMPLATE_DIRS || '').split(delimiter).filter(Boolean).map((d) => resolve(cwd, d)),
    renderCacheMb: cacheMb(env.DOSSIER_RENDER_CACHE_MB),
  };
}

/** DOSSIER_RENDER_CACHE_MB as a non-negative number; unset, blank or invalid gives the default (500), like PORT. */
function cacheMb(v) {
  const n = v === undefined || String(v).trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 500;
}
