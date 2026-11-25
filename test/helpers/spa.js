// A stand-in for the built web app (web/dist), so server tests never depend on whether `npm run build` has run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The fake index.html body. */
export const FAKE_INDEX = '<!doctype html><html><head><title>Dossier</title></head><body><div id="root"></div></body></html>';

/**
 * Write a minimal web app build (`index.html` and a `favicon.ico`) under `parent` and return its folder, for `buildServer`'s
 * `spaDir` option.
 * @param {string} parent a test's temporary directory
 * @param {string} [name] folder name (default `dist`)
 * @returns {string}
 */
export function fakeSpaDir(parent, name = 'dist') {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), FAKE_INDEX);
  writeFileSync(join(dir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  return dir;
}
