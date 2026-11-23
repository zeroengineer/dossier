import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Process-level configuration from the environment.
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [cwd]
 * @returns {{ home: string, dataDir: string, user: string, port: number }}
 */
export function loadConfig(env = process.env, cwd = process.cwd()) {
  const home = resolve(cwd, env.DOSSIER_HOME || 'workspace');
  return {
    home,
    dataDir: join(home, 'data'),
    user: env.DOSSIER_USER || userInfo().username,
    port: Number(env.PORT) || 4400,
  };
}
