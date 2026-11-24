// Disk cache of rendered renditions (docs/PLAN.md B9): `<dataDir>/cache/render/<key>.<kind>`, keyed on everything a
// render depends on, bounded by size and evicted least recently used first.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { REPO_ROOT } from '../paths.js';
import { brandAsset, trackBrandAssets } from '../workspace/index.js';

/** Default size bound of the render cache in MB (DOSSIER_RENDER_CACHE_MB overrides it; 0 turns the cache off). */
export const RENDER_CACHE_DEFAULT_MB = 500;
/** Bumped when the cache's file layout or key recipe changes. */
const FORMAT = 1;

/**
 * Source folders and files whose code shapes rendered bytes. Their combined hash is part of every key, so upgrading
 * Dossier (or editing a built-in template's shared helper) never serves a render made by other code.
 */
export const RENDER_CODE_PATHS = Object.freeze([
  'src/render', 'src/templates', 'src/workspace', 'src/domain', 'src/services/generator.js', 'src/services/fields.js',
  'src/paths.js',
]);

const require = createRequire(import.meta.url);

/** Version of an installed package, found from its entry point (works for packages that do not export package.json). */
function packageVersion(name, from = require) {
  try {
    let dir = dirname(from.resolve(name));
    for (;;) {
      const file = join(dir, 'package.json');
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file, 'utf8'));
        if (pkg.name === name) return pkg.version;
      }
      const up = dirname(dir);
      if (up === dir) return 'unknown';
      dir = up;
    }
  } catch {
    return 'unknown';
  }
}

let runtime = null;

/**
 * Hash of the shared render code (every file under RENDER_CODE_PATHS) and the versions of pdfkit, fontkit and sharp.
 * Computed once per process.
 * @returns {{ code: string, pdfkit: string, fontkit: string, sharp: string }}
 */
export function renderRuntime() {
  if (runtime) return runtime;
  const hash = createHash('sha256');
  const files = [];
  for (const rel of RENDER_CODE_PATHS) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs, { recursive: true }).map(String)) {
        const p = join(abs, f);
        if (statSync(p).isFile()) files.push(p);
      }
    } else {
      files.push(abs);
    }
  }
  for (const p of files.map((f) => relative(REPO_ROOT, f).split(sep).join('/')).sort()) {
    const buf = readFileSync(join(REPO_ROOT, p));
    hash.update(`${p}\u0000${buf.length}\u0000`).update(buf);
  }
  const pdfkitRequire = createRequire(require.resolve('pdfkit'));
  runtime = Object.freeze({
    code: hash.digest('hex'),
    pdfkit: packageVersion('pdfkit'),
    fontkit: packageVersion('fontkit', pdfkitRequire),
    sharp: packageVersion('sharp'),
  });
  return runtime;
}

/**
 * The cache folder of a context: `<dataDir>/cache/render`.
 * @param {{ config: { dataDir: string } }} ctx
 * @returns {string}
 */
export const renderCacheDir = (ctx) => join(ctx.config.dataDir, 'cache', 'render');

/** Size bound in bytes (`ctx.config.renderCacheMb`, default RENDER_CACHE_DEFAULT_MB); 0 turns the cache off. */
function limitBytes(ctx) {
  const mb = ctx.config?.renderCacheMb ?? RENDER_CACHE_DEFAULT_MB;
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 0;
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** File hashes by path, reused while size, mtime and inode are unchanged. */
const fileHashes = new Map();

/**
 * sha256 of a file's bytes, recomputed only when its size, mtime or inode changed; null when it does not exist.
 * @param {string} file
 * @returns {string|null}
 */
export function fileHash(file) {
  let st;
  try {
    st = statSync(file);
  } catch {
    fileHashes.delete(file);
    return null;
  }
  const stamp = `${st.size}:${st.mtimeMs}:${st.ino}`;
  const known = fileHashes.get(file);
  if (known?.stamp === stamp) return known.hash;
  const hash = sha256(readFileSync(file));
  fileHashes.set(file, { stamp, hash });
  return hash;
}

/**
 * @typedef {object} RenderSpec
 * @property {{ id: string, hash: string, meta: { version: number } }} template
 * @property {string} brandId
 * @property {string} valuesJson canonical JSON of the resolved values
 * @property {string} inputJson canonical JSON of the raw input (templates see it as env.input)
 * @property {string|null} number
 * @property {boolean} draft
 * @property {Date} creationDate embedded in the PDF info, so part of the key
 */

/**
 * The part of the key known before rendering: format, render code and library versions, template id, version and
 * hash, brand id and config hash, the workspace settings (`workspace.json`: locale and the rest), the canonical
 * values and input, number, draft flag and creation date.
 * @param {object} ctx
 * @param {RenderSpec} spec
 * @returns {string} sha256 hex
 */
export function baseKey(ctx, spec) {
  const rt = renderRuntime();
  return sha256(JSON.stringify([
    FORMAT, rt.code, rt.pdfkit, rt.fontkit, rt.sharp,
    spec.template.id, spec.template.meta.version, spec.template.hash,
    spec.brandId, ctx.ws.brandHashes.get(spec.brandId) ?? null, sha256(JSON.stringify(ctx.ws.config)),
    spec.valuesJson, spec.inputJson, spec.number ?? null, Boolean(spec.draft), spec.creationDate.toISOString(),
  ]));
}

/**
 * The full key: the base key plus, for every brand asset the render looked up, the file it resolves to now and that
 * file's sha256 (a missing file counts too, so adding a brand file that shadows an inherited one changes the key).
 * @param {object} ctx
 * @param {string} base
 * @param {Array<[string, string]>} used `[brandId, key]` pairs recorded by trackBrandAssets
 * @returns {string}
 */
export function fullKey(ctx, base, used) {
  const parts = [base];
  for (const [brandId, key] of used) {
    let file;
    try {
      file = brandAsset(ctx.ws, brandId, key);
    } catch (err) {
      parts.push(`${brandId}\u0000${key}\u0000error:${err.message}`);
      continue;
    }
    parts.push(`${brandId}\u0000${key}\u0000${file ?? '-'}\u0000${file ? fileHash(file) ?? '-' : '-'}`);
  }
  return sha256(parts.join('\n'));
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Mark files as just used (atime = now, mtime kept): eviction goes by atime, which mounts may not update on reads. */
function touch(files) {
  const now = new Date();
  for (const f of files) {
    try {
      utimesSync(f, now, statSync(f).mtime);
    } catch { /* evicted meanwhile */ }
  }
}

/** The stored renditions of a full key, or null when any file is missing or does not match its recorded hash. */
function readEntry(dir, full) {
  const metaFile = join(dir, `${full}.json`);
  const meta = readJson(metaFile);
  if (!meta || !Array.isArray(meta.kinds)) return null;
  const out = [];
  for (const k of meta.kinds) {
    let buffer;
    try {
      buffer = readFileSync(join(dir, `${full}.${k.kind}`));
    } catch {
      return null;
    }
    if (buffer.byteLength !== k.bytes || sha256(buffer) !== k.sha256) return null;
    out.push({ kind: k.kind, buffer, mime: k.mime });
  }
  out.warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
  touch([metaFile, ...meta.kinds.map((k) => join(dir, `${full}.${k.kind}`))]);
  return out;
}

function storeEntry(dir, base, full, used, rendered) {
  mkdirSync(dir, { recursive: true });
  for (const r of rendered) writeAtomic(join(dir, `${full}.${r.kind}`), r.buffer);
  writeAtomic(join(dir, `${full}.json`), JSON.stringify({
    kinds: rendered.map((r) => ({ kind: r.kind, mime: r.mime, bytes: r.buffer.byteLength, sha256: sha256(r.buffer) })),
    warnings: rendered.warnings ?? [],
  }));
  writeAtomic(join(dir, `${base}.assets.json`), JSON.stringify({ used }));
}

/**
 * Delete least recently used entries until the folder holds at most `limit` bytes. An entry is every file named
 * `<key>.*` (renditions and meta of a full key, or the asset manifest of a base key); its last use is the latest
 * atime of its files, and it is removed whole.
 * @param {string} dir
 * @param {number} limit bytes
 * @returns {{ files: number, bytes: number }} what was removed
 */
export function evictRenderCache(dir, limit) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { files: 0, bytes: 0 };
  }
  const groups = new Map();
  let total = 0;
  for (const name of names) {
    let st;
    try {
      st = statSync(join(dir, name));
    } catch {
      continue; // removed meanwhile
    }
    if (!st.isFile()) continue;
    const id = /^[0-9a-f]{64}\./.test(name) ? name.slice(0, 64) : name;
    const g = groups.get(id) ?? { id, files: [], size: 0, atime: 0 };
    g.files.push(name);
    g.size += st.size;
    g.atime = Math.max(g.atime, st.atimeMs);
    groups.set(id, g);
    total += st.size;
  }
  const removed = { files: 0, bytes: 0 };
  if (total <= limit) return removed;
  for (const g of [...groups.values()].sort((a, b) => a.atime - b.atime || (a.id < b.id ? -1 : 1))) {
    if (total <= limit) break;
    for (const f of g.files) rmSync(join(dir, f), { force: true });
    total -= g.size;
    removed.files += g.files.length;
    removed.bytes += g.size;
  }
  return removed;
}

/**
 * Render through the cache. The base key (see baseKey) finds the list of brand assets an earlier render of the same
 * inputs looked up; with the current hashes of those files it gives the full key, and a complete, intact entry under
 * it is returned without rendering (byte-identical to what was stored). Otherwise `render` runs with brand-asset
 * tracking, its renditions are stored under the full key of the assets it actually used, and the folder is trimmed
 * to the size bound. Cache failures never fail a render: an unreadable or unwritable cache only costs a render.
 * @param {object} ctx
 * @param {RenderSpec} spec
 * @param {() => Promise<Array<{ kind: string, buffer: Buffer, mime: string }> & { warnings: object[] }>} render
 * @returns {Promise<Array<{ kind: string, buffer: Buffer, mime: string }> & { warnings: object[], cached: boolean }>}
 *   `cached`: true when served from the cache
 */
export async function renderCached(ctx, spec, render) {
  const limit = limitBytes(ctx);
  if (limit === 0) return Object.assign(await render(), { cached: false });
  const dir = renderCacheDir(ctx);
  const base = baseKey(ctx, spec);
  const manifest = readJson(join(dir, `${base}.assets.json`));
  if (manifest && Array.isArray(manifest.used)) {
    const hit = readEntry(dir, fullKey(ctx, base, manifest.used));
    if (hit) {
      touch([join(dir, `${base}.assets.json`)]);
      return Object.assign(hit, { cached: true });
    }
  }
  const { result, used } = await trackBrandAssets(render);
  try {
    storeEntry(dir, base, fullKey(ctx, base, used), used, result);
    evictRenderCache(dir, limit);
  } catch (err) {
    process.emitWarning(`render cache not written: ${err.message}`, { code: 'DOSSIER_RENDER_CACHE' });
  }
  return Object.assign(result, { cached: false });
}

/**
 * Remove every file of a context's render cache (`dossier cache clear`).
 * @param {object} ctx
 * @returns {{ files: number, bytes: number }} what was removed
 */
export function clearRenderCache(ctx) {
  const dir = renderCacheDir(ctx);
  const removed = evictRenderCache(dir, -1);
  return removed;
}
