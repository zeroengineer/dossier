import { userInfo } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

/**
 * Process-level configuration from the environment.
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [cwd]
 * @returns {{ home: string, dataDir: string, user: string, port: number, templateDirs: string[] }}
 *   `templateDirs` (DOSSIER_TEMPLATE_DIRS, separated like PATH) are extra template folders loaded after the built-ins and
 *   before the workspace's `templates/`.
 */
export function loadConfig(env = process.env, cwd = process.cwd()) {
  const home = resolve(cwd, env.DOSSIER_HOME || 'workspace');
  return {
    home,
    dataDir: join(home, 'data'),
    user: env.DOSSIER_USER || userInfo().username,
    port: Number(env.PORT) || 4400,
    templateDirs: (env.DOSSIER_TEMPLATE_DIRS || '').split(delimiter).filter(Boolean).map((d) => resolve(cwd, d)),
  };
}
