import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { EXAMPLE_WORKSPACE, FONTS_DIR, PLACEHOLDERS_DIR } from '../paths.js';
import { BrandSchema, CLEARANCES, FONT_WEIGHTS, SeedsSchema, SeriesFileSchema, WorkspaceSchema, formatIssues } from './schemas.js';

/** A workspace file failed to load or validate. `file` is relative to the workspace home. */
export class WorkspaceError extends Error {
  /** @param {string} file @param {string} detail */
  constructor(file, detail) {
    super(`${file}: ${detail}`);
    this.name = 'WorkspaceError';
    this.file = file;
    this.detail = detail;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep merge for brand inheritance: plain objects merge recursively, everything else (arrays included) is replaced by `over`.
 * @param {any} base @param {any} over
 * @returns {any}
 */
export function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

function readJson(home, rel, { optional = false, files } = {}) {
  if (files?.has(rel)) return structuredClone(files.get(rel));
  const file = join(home, rel);
  if (!existsSync(file)) {
    if (optional) return undefined;
    throw new WorkspaceError(rel, `file not found (looked in ${home})`);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new WorkspaceError(rel, `invalid JSON (${e.message})`);
  }
}

function validate(schema, value, rel) {
  const r = schema.safeParse(value);
  if (!r.success) throw new WorkspaceError(rel, `invalid:\n${formatIssues(r.error).replace(/^/gm, '  ')}`);
  return r.data;
}

function stableStringify(v) {
  if (v instanceof Map) return stableStringify(Object.fromEntries([...v.entries()].sort(([a], [b]) => (a < b ? -1 : 1))));
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const BUILTIN_STYLE = { regular: 'Regular', medium: 'Medium', semibold: 'SemiBold', bold: 'Bold', extrabold: 'ExtraBold', light: 'Light', extralight: 'ExtraLight' };

/** Path of a `builtin:<Family>-<Style>` font, or null when the spec is not builtin. */
function builtinFontPath(spec) {
  const m = /^builtin:([A-Za-z0-9]+)-([A-Za-z0-9]+)$/.exec(spec);
  if (!m) return spec.startsWith('builtin:') ? join(FONTS_DIR, '__invalid__') : null;
  return join(FONTS_DIR, m[1], `${m[1]}-${m[2]}.ttf`);
}

/**
 * Load and validate a workspace directory.
 * @param {string} home workspace root (DOSSIER_HOME)
 * @param {{ files?: Map<string, unknown> }} [opts] `files`: parsed JSON bodies used instead of the files on disk, keyed
 *   by workspace-relative path (`workspace.json`, `series.json`, `brands/<id>/brand.json`), so a candidate edit can be
 *   validated against the rest of the workspace before anything is written. A `brands/<id>/brand.json` key adds that
 *   brand even when its folder does not exist yet.
 * @returns {{ home: string, config: object, brands: Map<string, object>, series: Map<string, object>, templatesDir: string,
 *   seeds: { entities: object[], relations: object[] }, configHash: string, brandHashes: Map<string, string>, brandDirs: Map<string, string[]> }}
 */
export function loadWorkspace(home, { files } = {}) {
  home = resolve(home);
  const config = validate(WorkspaceSchema, readJson(home, 'workspace.json', { files }), 'workspace.json');

  const seriesList = validate(SeriesFileSchema, readJson(home, 'series.json', { optional: true, files }) ?? [], 'series.json');
  const series = new Map(seriesList.map((s) => [s.id, s]));

  const seeds = validate(SeedsSchema, readJson(home, 'seeds/entities.json', { optional: true, files }) ?? {}, 'seeds/entities.json');

  // Raw brand files, keyed by directory name.
  const brandsRoot = join(home, 'brands');
  const raw = new Map();
  const names = new Set(existsSync(brandsRoot) ? readdirSync(brandsRoot) : []);
  for (const key of files?.keys() ?? []) {
    const m = /^brands\/([^/]+)\/brand\.json$/.exec(key);
    if (m) names.add(m[1]);
  }
  for (const name of [...names].sort()) {
    const rel = `brands/${name}/brand.json`;
    if (!files?.has(rel) && (!statSync(join(brandsRoot, name)).isDirectory() || !existsSync(join(home, rel)))) continue;
    const body = readJson(home, rel, { files });
    if (!isPlainObject(body)) throw new WorkspaceError(rel, 'invalid: (root): expected an object');
    if (body.id !== name) throw new WorkspaceError(rel, `invalid:\n  id: "${body.id}" must match the folder name "${name}"`);
    raw.set(name, body);
  }

  // Resolve inheritance (merge raw JSON, then validate the merged result).
  const merged = new Map();
  const brandDirs = new Map();
  const resolveBrand = (bid, trail) => {
    if (merged.has(bid)) return merged.get(bid);
    const rel = `brands/${bid}/brand.json`;
    if (trail.includes(bid)) throw new WorkspaceError(rel, `invalid:\n  inheritsFrom: cycle ${[...trail, bid].join(' -> ')}`);
    const body = raw.get(bid);
    let out = body;
    let dirs = [join(brandsRoot, bid)];
    if (body.inheritsFrom !== undefined) {
      if (!raw.has(body.inheritsFrom)) throw new WorkspaceError(rel, `invalid:\n  inheritsFrom: unknown brand "${body.inheritsFrom}"`);
      out = deepMerge(resolveBrand(body.inheritsFrom, [...trail, bid]), body);
      dirs = [...dirs, ...brandDirs.get(body.inheritsFrom)];
    }
    merged.set(bid, out);
    brandDirs.set(bid, dirs);
    return out;
  };
  for (const bid of raw.keys()) resolveBrand(bid, []);

  const brands = new Map();
  const brandHashes = new Map();
  for (const [bid, body] of merged) {
    const rel = `brands/${bid}/brand.json`;
    const brand = validate(BrandSchema, body, rel);
    const problems = [];
    for (const [tid, sid] of Object.entries(brand.series)) {
      if (!series.has(sid)) problems.push(`series.${tid}: unknown series "${sid}" (not in series.json)`);
    }
    for (const [weight, spec] of Object.entries(brand.fonts)) {
      const p = builtinFontPath(spec);
      if (p && !existsSync(p)) problems.push(`fonts.${weight}: unknown built-in font "${spec}"`);
    }
    if (problems.length) throw new WorkspaceError(rel, `invalid:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    brands.set(bid, brand);
    brandHashes.set(bid, sha256(stableStringify(brand)));
  }

  if (!brands.has(config.defaultBrand)) {
    throw new WorkspaceError('workspace.json', `invalid:\n  defaultBrand: no brand "${config.defaultBrand}" under brands/ (found: ${[...brands.keys()].join(', ') || 'none'})`);
  }
  seeds.entities.forEach((e, i) => {
    if (e.brand && !brands.has(e.brand)) throw new WorkspaceError('seeds/entities.json', `invalid:\n  entities.${i}.brand: unknown brand "${e.brand}"`);
  });

  const configHash = sha256(stableStringify({ config, brands, series, seeds }));
  return { home, config, brands, series, templatesDir: join(home, 'templates'), seeds, configHash, brandHashes, brandDirs };
}

/** First existing file for a brand-relative path, searching the brand then its ancestors. */
function findInBrandDirs(ws, brandId, relPath) {
  if (!relPath) return null;
  if (isAbsolute(relPath)) return existsSync(relPath) ? relPath : null;
  for (const dir of ws.brandDirs.get(brandId)) {
    const p = resolve(dir, relPath);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Absolute path of a brand asset, falling back to the shipped placeholders / built-in Manrope when the brand file is missing.
 * Keys: `assets.logo`, `assets.seal`, `assets.watermark` (null when unset/missing), `signature:<signatoryId>`,
 * `signature-large:<signatoryId>`, `font:<weight>`.
 * @param {ReturnType<typeof loadWorkspace>} ws
 * @param {string} brandId
 * @param {string} key
 * @returns {string|null}
 */
export function brandAsset(ws, brandId, key) {
  const brand = ws.brands.get(brandId);
  if (!brand) throw new Error(`brandAsset: unknown brand "${brandId}"`);
  const [kind, arg] = key.split(':');
  if (key === 'assets.logo') return findInBrandDirs(ws, brandId, brand.assets.logo) ?? join(PLACEHOLDERS_DIR, 'logo.png');
  if (key === 'assets.seal') return findInBrandDirs(ws, brandId, brand.assets.seal ?? 'assets/seal.png') ?? join(PLACEHOLDERS_DIR, 'seal.png');
  if (key === 'assets.watermark') return findInBrandDirs(ws, brandId, brand.assets.watermark);
  if ((kind === 'signature' || kind === 'signature-large') && arg) {
    const s = brand.signatories.find((x) => x.id === arg);
    if (!s) throw new Error(`brandAsset: brand "${brandId}" has no signatory "${arg}"`);
    if (kind === 'signature') return findInBrandDirs(ws, brandId, s.signature) ?? join(PLACEHOLDERS_DIR, 'signature.png');
    return findInBrandDirs(ws, brandId, s.signatureLarge ?? s.signature) ?? join(PLACEHOLDERS_DIR, 'signature-large.png');
  }
  if (kind === 'font' && FONT_WEIGHTS.includes(arg)) {
    const spec = brand.fonts[arg];
    const fallback = join(FONTS_DIR, 'Manrope', `Manrope-${BUILTIN_STYLE[arg]}.ttf`);
    const builtin = builtinFontPath(spec);
    if (builtin) return existsSync(builtin) ? builtin : fallback;
    return findInBrandDirs(ws, brandId, spec) ?? fallback;
  }
  throw new Error(`brandAsset: unknown asset key "${key}"`);
}

/** A placeholder name kept as written by interpolate() when it does not resolve (numbering tokens). */
const UPPERCASE_TOKEN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Replace `{a.b.c}` placeholders with values from `scope`; missing or non-scalar values become ''.
 * Only identifier paths are replaced, so numbering tokens like `{####}` are left alone. An all-uppercase single name
 * that does not resolve (`{YYYY}`, `{FY}`, `{CODE}`, `{CLIENT}`, …) is also kept as written, so numbering tokens
 * survive; it is still replaced when `scope` has a value under that name.
 * @param {string|undefined|null} str
 * @param {object} scope
 * @returns {string}
 */
export function interpolate(str, scope) {
  if (str == null) return '';
  return String(str).replace(/\{([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\}/g, (token, path) => {
    let v = scope;
    for (const part of path.split('.')) {
      if (v == null || typeof v !== 'object') { v = undefined; break; }
      v = v[part];
    }
    if (v === undefined && UPPERCASE_TOKEN.test(path)) return token;
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' ? String(v) : '';
  });
}

/**
 * Clearance of a local user id; unknown users get 'Confidential'.
 * @param {{ config: { users: Record<string, { clearance: string }> } }} ws
 * @param {string} userId
 * @returns {'Public'|'Internal'|'Confidential'|'Restricted'}
 */
export function clearanceFor(ws, userId) {
  const c = ws.config.users[userId]?.clearance;
  return CLEARANCES.includes(c) ? c : 'Confidential';
}

/**
 * Create a new workspace by copying an existing tree (default: the shipped example). Refuses a non-empty target.
 * @param {string} target
 * @param {{ from?: string }} [opts]
 * @returns {string} absolute target path
 */
export function initWorkspace(target, { from = EXAMPLE_WORKSPACE } = {}) {
  target = resolve(target);
  from = resolve(from);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`refusing to initialise ${target}: directory is not empty`);
  }
  if (!existsSync(join(from, 'workspace.json'))) throw new Error(`initWorkspace: ${from} has no workspace.json`);
  mkdirSync(target, { recursive: true });
  cpSync(from, target, {
    recursive: true,
    filter: (src) => {
      const rel = relative(from, src).split(/[\\/]/);
      return !(rel[0] === 'data' || rel.at(-1) === '.DS_Store');
    },
  });
  return target;
}
