// Editing the workspace files (workspace.json, series.json, brands/<id>/brand.json and brand assets) from the web UI
// and API. Every write is validated against the whole workspace first (the candidate file replaces the one on disk in
// an in-memory load), then written atomically (temp file in the same folder + rename), audited as `workspace.write`,
// and the context's workspace is reloaded so the next request sees the change without a restart.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';
import sharp from 'sharp';
import { DossierError } from '../errors.js';
import { FONTS_DIR } from '../paths.js';
import { syncBrands } from '../context.js';
import { clearanceFor, loadWorkspace, WorkspaceError } from '../workspace/index.js';
import { CLEARANCES, FONT_WEIGHTS } from '../workspace/schemas.js';
import { clearImageCache } from '../render/pdf/images.js';
import { listTemplateErrors, listTemplates } from './templates.js';
import { memoOf, WS } from '../cache/memo.js';

const PDFDocument = createRequire(import.meta.url)('pdfkit');

/** Largest accepted asset upload (bytes). */
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;

/**
 * `builtin:<Family>-<Style>` names of the fonts bundled in `assets/fonts`, sorted.
 * @returns {string[]}
 */
export function builtinFonts() {
  if (!existsSync(FONTS_DIR)) return [];
  return readdirSync(FONTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => readdirSync(join(FONTS_DIR, d.name))
    .filter((f) => /\.ttf$/i.test(f) && f.startsWith(`${d.name}-`))
    .map((f) => `builtin:${f.replace(/\.ttf$/i, '')}`)).sort();
}

/** Largest before/after JSON text kept in one audit row; longer bodies are stored truncated with their hash. */
export const AUDIT_CAP = 64 * 1024;

const BRAND_ID = /^[a-z0-9][a-z0-9_-]*$/;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Workspace-relative path of a brand file. */
export const brandRel = (id) => `brands/${id}/brand.json`;

/**
 * A WORKSPACE_INVALID error carrying field errors `[{ file, path, message }]` (path is dotted, '(root)' for the file).
 * @param {string} file
 * @param {Array<{ file?: string, path: string, message: string }>} errors
 * @returns {DossierError}
 */
export function workspaceInvalid(file, errors) {
  const list = errors.map((e) => ({ file: e.file ?? file, path: e.path, message: e.message }));
  const text = list.map((e) => `${e.file === file ? '' : `${e.file} `}${e.path}: ${e.message}`).join('; ');
  return new DossierError('WORKSPACE_INVALID', `${file}: ${text}`, { file, errors: list });
}

/** Field errors from a WorkspaceError detail (`invalid:\n  path: message` lines, or one free-text detail). */
export function issuesOf(err) {
  const lines = String(err.detail ?? err.message).split('\n');
  if (lines[0].startsWith('invalid:') && lines.length > 1) {
    return lines.slice(1).filter((l) => l.trim()).map((l) => {
      const t = l.trim();
      const i = t.indexOf(': ');
      return i > 0 ? { file: err.file, path: t.slice(0, i), message: t.slice(i + 2) } : { file: err.file, path: '(root)', message: t };
    });
  }
  return [{ file: err.file, path: '(root)', message: String(err.detail ?? err.message).replace(/^invalid:\s*/, '') }];
}

/**
 * Write bytes atomically: a temp file in the same folder (exclusive create, fsync) renamed over the target.
 * @param {string} file absolute path
 * @param {string|Buffer} data
 */
export function writeFileAtomic(file, data) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${posix.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', 0o644);
  try {
    try {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  // Make the rename durable; not every platform can open or fsync a directory.
  try {
    const dfd = openSync(dir, 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch { /* best effort */ }
}

/** Parsed JSON of a workspace file, or undefined when it does not exist. */
function readRaw(ctx, rel) {
  const file = join(ctx.ws.home, rel);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** An audit value: the body itself, or a truncated record when its JSON is longer than AUDIT_CAP. */
function capped(body) {
  if (body === undefined || body === null) return null;
  const text = JSON.stringify(body);
  if (text.length <= AUDIT_CAP) return body;
  return { truncated: true, length: text.length, sha256: sha256(text), text: text.slice(0, AUDIT_CAP) };
}

/**
 * Validate `body` as the new content of workspace file `rel` against the rest of the workspace, write it atomically,
 * reload `ctx.ws`, sync the brand rows (config hash) and audit. Throws WORKSPACE_INVALID (file untouched) when the
 * workspace would not load.
 * @param {object} ctx
 * @param {string} rel workspace-relative path
 * @param {unknown} body parsed JSON
 * @param {{ check?: (candidate: object) => Array<{ file?: string, path: string, message: string }>,
 *   audits?: Array<[string, string, string, unknown, unknown]> }} [opts] audits: more audit rows for the same transaction
 * @returns {object} the reloaded workspace
 */
function commit(ctx, rel, body, { check, audits = [] } = {}) {
  const home = ctx.ws.home;
  let candidate;
  try {
    candidate = loadWorkspace(home, { files: new Map([[rel, body]]) });
  } catch (err) {
    if (err instanceof WorkspaceError) throw workspaceInvalid(rel, issuesOf(err));
    throw err;
  }
  const extra = check?.(candidate) ?? [];
  if (extra.length) throw workspaceInvalid(rel, extra);

  const file = join(home, rel);
  const beforeBytes = existsSync(file) ? readFileSync(file) : null;
  const before = beforeBytes ? JSON.parse(beforeBytes.toString('utf8')) : null;
  writeFileAtomic(file, `${JSON.stringify(body, null, 2)}\n`);
  let ws;
  try {
    ws = loadWorkspace(home);
  } catch (err) {
    // Another writer changed the workspace in between: put our file back as it was.
    if (beforeBytes) writeFileAtomic(file, beforeBytes);
    else rmSync(file, { force: true });
    if (err instanceof WorkspaceError) throw workspaceInvalid(rel, issuesOf(err));
    throw err;
  }
  ctx.ws = ws;
  if (ctx.user) ctx.user.clearance = clearanceFor(ws, ctx.user.id);
  ctx.repo.tx(() => {
    ctx.repo.audit('workspace.write', 'workspace', rel, capped(before), capped(body));
    for (const a of audits) ctx.repo.audit(...a);
    syncBrands(ctx.repo, ws);
  });
  return ws;
}

// ---------- brands ----------

function assertBrandId(id) {
  if (typeof id !== 'string' || !BRAND_ID.test(id)) {
    throw new DossierError('INVALID_INPUT', `Brand id "${id}" must be lowercase letters, digits, "-" or "_"`, { id });
  }
}

/**
 * A brand as stored and as resolved: `file` is its own brand.json (what an edit replaces), `parent` the resolved
 * brand it inherits from (or null), `resolved` the validated brand with inheritance and defaults applied.
 * @param {object} ctx
 * @param {string} id
 * @returns {{ id: string, file: object, parent: object|null, resolved: object, configHash: string }}
 */
export function getBrandFile(ctx, id) {
  if (!ctx.ws.brands.has(id)) throw new DossierError('BRAND_NOT_FOUND', `No brand "${id}" in the workspace`, { brandId: id });
  // Memoised on the workspace configuration and the brand file's size and mtime (a hand edit not yet reloaded counts).
  let stamp = '-';
  try {
    const st = statSync(join(ctx.ws.home, brandRel(id)));
    stamp = `${st.size}:${st.mtimeMs}`;
  } catch { /* missing: readRaw reports it */ }
  return structuredClone(memoOf(ctx)(`brand\u0000${id}\u0000${stamp}`, [WS], () => brandFile(ctx, id)));
}

function brandFile(ctx, id) {
  const file = readRaw(ctx, brandRel(id));
  if (file === undefined) throw new DossierError('BRAND_NOT_FOUND', `No brand "${id}" in the workspace`, { brandId: id });
  const resolved = ctx.ws.brands.get(id);
  const parent = resolved.inheritsFrom ? ctx.ws.brands.get(resolved.inheritsFrom) ?? null : null;
  return { id, file, parent, resolved, configHash: ctx.ws.brandHashes.get(id) };
}

/** True when `p` is a plain relative path that stays inside the brand folder. */
export function isSafeRelPath(p) {
  if (typeof p !== 'string' || p === '' || p.includes('\\') || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  const n = posix.normalize(p);
  return n === p && n !== '..' && !n.startsWith('../') && !n.startsWith('./');
}

/** Path fields of a brand body: `[{ path, value, key }]` (key identifies the slot across edits). */
function pathFields(body) {
  const out = [];
  if (!isPlainObject(body)) return out;
  for (const k of ['logo', 'seal', 'watermark']) {
    if (body.assets?.[k] !== undefined) out.push({ path: `assets.${k}`, key: `assets.${k}`, value: body.assets[k] });
  }
  for (const [w, v] of Object.entries(isPlainObject(body.fonts) ? body.fonts : {})) {
    if (typeof v !== 'string' || !v.startsWith('builtin:')) out.push({ path: `fonts.${w}`, key: `fonts.${w}`, value: v, font: true });
  }
  (Array.isArray(body.signatories) ? body.signatories : []).forEach((s, i) => {
    for (const k of ['signature', 'signatureLarge']) {
      if (isPlainObject(s) && s[k] !== undefined) out.push({ path: `signatories.${i}.${k}`, key: `sig:${s.id}:${k}`, value: s[k] });
    }
  });
  return out;
}

/** Field errors for asset paths that changed and leave the brand folder (or a font that is not a .ttf/.otf file). */
function pathErrors(rel, body, before, exists) {
  const old = new Map(pathFields(before).map((f) => [f.key, f.value]));
  const errors = [];
  for (const f of pathFields(body)) {
    if (old.get(f.key) === f.value) continue;
    if (!isSafeRelPath(f.value)) {
      errors.push({ file: rel, path: f.path, message: 'must be a relative path inside the brand folder (no "..", no absolute path)' });
    } else if (f.font && !/\.(ttf|otf)$/i.test(f.value)) {
      errors.push({ file: rel, path: f.path, message: 'must be "builtin:<Family>-<Style>" or a .ttf/.otf file' });
    } else if (!exists(f.value)) {
      errors.push({ file: rel, path: f.path, message: `no file "${f.value}" in the brand folder${body.inheritsFrom ? ' or the brands it inherits from' : ''} (upload it instead)` });
    }
  }
  return errors;
}

/**
 * Create or replace a brand's brand.json. `body.id` defaults to `id` and must equal it.
 * @param {object} ctx
 * @param {string} id
 * @param {object} body the complete brand.json content (for a brand with `inheritsFrom`, only the overridden fields)
 * @param {{ create?: boolean, audits?: Array<[string, string, string, unknown, unknown]> }} [opts] create: refuse
 *   (BRAND_DUPLICATE) when the brand exists; audits: more audit rows written with the brand.json one
 * @returns {{ created: boolean } & ReturnType<typeof getBrandFile>}
 */
export function writeBrand(ctx, id, body, { create = false, audits } = {}) {
  assertBrandId(id);
  const rel = brandRel(id);
  if (!isPlainObject(body)) throw workspaceInvalid(rel, [{ path: '(root)', message: 'expected a JSON object' }]);
  body = { ...body, id: body.id ?? id };
  if (body.id !== id) throw workspaceInvalid(rel, [{ path: 'id', message: `"${body.id}" must equal the brand id "${id}"` }]);
  const exists = existsSync(join(ctx.ws.home, rel));
  if (create && (exists || ctx.ws.brands.has(id))) throw new DossierError('BRAND_DUPLICATE', `Brand "${id}" already exists`, { brandId: id });
  const before = exists ? readRaw(ctx, rel) : undefined;
  // Changed paths must name an existing file in this brand's folder or a parent's (as brandAsset looks them up).
  const dirs = [join(ctx.ws.home, 'brands', id), ...(typeof body.inheritsFrom === 'string' ? ctx.ws.brandDirs.get(body.inheritsFrom) ?? [] : [])];
  const errors = pathErrors(rel, body, before, (p) => dirs.some((d) => existsSync(join(d, ...p.split('/')))));
  if (errors.length) throw workspaceInvalid(rel, errors);
  commit(ctx, rel, body, { audits });
  return { created: !exists, ...getBrandFile(ctx, id) };
}

// ---------- brand assets ----------

const IMAGE_SLOTS = ['logo', 'seal', 'watermark'];

/**
 * Parse an asset key: `logo`, `seal`, `watermark` (or `assets.<name>`), `signature:<signatoryId>`,
 * `signature-large:<signatoryId>`, `font:<weight>`.
 * @param {string} key
 * @returns {{ kind: 'image'|'signature'|'font', slot: string, arg?: string }}
 */
export function parseAssetKey(key) {
  const k = String(key ?? '').replace(/^assets\./, '');
  if (IMAGE_SLOTS.includes(k)) return { kind: 'image', slot: k };
  const m = /^(signature|signature-large|font):([a-z0-9][a-z0-9_-]*)$/.exec(k);
  if (m && m[1] === 'font' && FONT_WEIGHTS.includes(m[2])) return { kind: 'font', slot: 'font', arg: m[2] };
  if (m && m[1] !== 'font') return { kind: 'signature', slot: m[1], arg: m[2] };
  throw new DossierError('INVALID_INPUT', `Unknown asset key "${key}" (logo, seal, watermark, signature:<id>, signature-large:<id>, font:<weight>)`, { key });
}

const assetInvalid = (message, details = {}) => new DossierError('ASSET_INVALID', message, details);

/** Detect and fully decode a PNG or JPEG; returns its extension. */
async function checkImage(buffer) {
  const png = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!png && !jpeg) throw assetInvalid('Images must be PNG or JPEG files');
  try {
    const meta = await sharp(buffer, { failOn: 'error' }).metadata();
    if (meta.format !== (png ? 'png' : 'jpeg')) throw new Error(`decoded as ${meta.format}`);
    await sharp(buffer, { failOn: 'error' }).stats();
  } catch (err) {
    throw assetInvalid(`The image could not be decoded (${err.message})`);
  }
  return png ? 'png' : 'jpg';
}

/** Detect a TrueType/OpenType font and check that pdfkit can read it; returns its extension. */
function checkFont(buffer) {
  const head = buffer.subarray(0, 4);
  const ttf = head.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || head.toString('latin1') === 'true';
  const otf = head.toString('latin1') === 'OTTO';
  if (!ttf && !otf) throw assetInvalid('Fonts must be TrueType (.ttf) or OpenType (.otf) files');
  try {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.registerFont('Check', buffer);
    doc.font('Check');
  } catch (err) {
    throw assetInvalid(`The font could not be read (${err.message})`);
  }
  return otf ? 'otf' : 'ttf';
}

/**
 * Store an uploaded brand asset under `brands/<id>/assets/` with a generated name (slot + content hash; nothing from
 * the client's file name) and point brand.json at it. Images must be PNG/JPEG (magic bytes, decoded with sharp), fonts
 * TTF/OTF (magic bytes, parsed by pdfkit), at most ASSET_MAX_BYTES. A signature of a brand that inherits its
 * signatories copies the inherited list into the brand first (arrays are inherited whole).
 * @param {object} ctx
 * @param {string} brandId
 * @param {string} key see parseAssetKey
 * @param {{ buffer: Buffer }} file
 * @returns {Promise<{ key: string, path: string, sha256: string, bytes: number } & ReturnType<typeof getBrandFile>>}
 */
export async function storeBrandAsset(ctx, brandId, key, { buffer }) {
  getBrandFile(ctx, brandId);
  const k = parseAssetKey(key);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw assetInvalid('The uploaded file is empty');
  if (buffer.length > ASSET_MAX_BYTES) {
    throw new DossierError('ASSET_TOO_LARGE', `Assets are limited to ${ASSET_MAX_BYTES / 1024 / 1024} MB`, { bytes: buffer.length, max: ASSET_MAX_BYTES });
  }
  const ext = k.kind === 'font' ? checkFont(buffer) : await checkImage(buffer);
  const hash = sha256(buffer);

  // Re-read after the async checks: the brand may have changed meanwhile.
  const { file: own, resolved } = getBrandFile(ctx, brandId);
  const body = structuredClone(own);
  let rel;
  if (k.kind === 'image') {
    rel = `assets/${k.slot}-${hash.slice(0, 12)}.${ext}`;
    body.assets = { ...(isPlainObject(body.assets) ? body.assets : {}), [k.slot]: rel };
  } else if (k.kind === 'font') {
    rel = `assets/fonts/${k.arg}-${hash.slice(0, 12)}.${ext}`;
    body.fonts = { ...(isPlainObject(body.fonts) ? body.fonts : {}), [k.arg]: rel };
  } else {
    const list = structuredClone(Array.isArray(body.signatories) ? body.signatories : resolved.signatories);
    const s = list.find((x) => x.id === k.arg);
    if (!s) throw new DossierError('INVALID_INPUT', `Brand "${brandId}" has no signatory "${k.arg}"`, { brandId, signatoryId: k.arg });
    rel = `assets/sign-${k.arg}${k.slot === 'signature-large' ? '-large' : ''}-${hash.slice(0, 12)}.${ext}`;
    s[k.slot === 'signature-large' ? 'signatureLarge' : 'signature'] = rel;
    body.signatories = list;
  }

  const abs = join(ctx.ws.home, 'brands', brandId, ...rel.split('/'));
  const existed = existsSync(abs);
  if (!existed) writeFileAtomic(abs, buffer);
  try {
    writeBrand(ctx, brandId, body, {
      audits: [['workspace.write', 'workspace', `brands/${brandId}/${rel}`, null, { key, sha256: hash, bytes: buffer.length }]],
    });
  } catch (err) {
    if (!existed) rmSync(abs, { force: true });
    throw err;
  }
  clearImageCache();
  return { key, path: rel, sha256: hash, bytes: buffer.length, ...getBrandFile(ctx, brandId) };
}

// ---------- series.json ----------

/** series.json as stored (an empty list when the file does not exist). */
export function getSeriesFile(ctx) {
  return readRaw(ctx, 'series.json') ?? [];
}

/**
 * Replace series.json. Besides the workspace checks (patterns, shared counters, brands' series maps), a change that
 * would break a template that loads today (its `numbering.series` gone) is refused.
 * @param {object} ctx
 * @param {unknown} list
 * @returns {object[]} the stored list
 */
export function writeSeries(ctx, list) {
  if (!Array.isArray(list)) throw workspaceInvalid('series.json', [{ path: '(root)', message: 'expected a JSON array of series' }]);
  const broken = new Set(listTemplateErrors(ctx).map((e) => e.id));
  commit(ctx, 'series.json', list, {
    check: (candidate) => listTemplateErrors({ ...ctx, ws: candidate })
      .filter((e) => !broken.has(e.id))
      .map((e) => ({ path: '(root)', message: `template "${e.id}" would no longer load: ${e.message}` })),
  });
  return getSeriesFile(ctx);
}

/**
 * Where each series is used: `<brandId>: <documentType>` for every brand series-map entry and `template <id>` for a
 * template whose `numbering.series` names a series directly (not `brand`).
 * @param {object} ctx
 * @returns {Record<string, string[]>} series id -> uses, in workspace order
 */
export function seriesUsage(ctx) {
  const usage = {};
  const add = (sid, what) => { (usage[sid] ??= []).push(what); };
  for (const [bid, b] of ctx.ws.brands) for (const [tid, sid] of Object.entries(b.series)) add(sid, `${bid}: ${tid}`);
  for (const t of listTemplates(ctx)) if (t.meta.numbering?.series && t.meta.numbering.series !== 'brand') add(t.meta.numbering.series, `template ${t.id}`);
  return usage;
}

// ---------- workspace.json ----------

/** workspace.json as stored. */
export function getWorkspaceFile(ctx) {
  return readRaw(ctx, 'workspace.json');
}

/**
 * Replace workspace.json. A user's clearance may not be raised above the acting user's own clearance.
 * @param {object} ctx
 * @param {unknown} body
 * @returns {object} the stored body
 */
export function writeWorkspaceConfig(ctx, body) {
  const rel = 'workspace.json';
  if (!isPlainObject(body)) throw workspaceInvalid(rel, [{ path: '(root)', message: 'expected a JSON object' }]);
  commit(ctx, rel, body, { check: (candidate) => clearanceErrors(ctx, candidate) });
  return getWorkspaceFile(ctx);
}

/**
 * The clearance rule of a workspace.json edit, on effective clearances (an unlisted user or a blank clearance is
 * Confidential): no user may end up above the acting user unless already there unchanged (a newly listed user counts
 * as granted), and a listed user ranked above the acting user may not be changed or removed. Adding a user at or
 * below the acting user's clearance is allowed.
 * @param {object} ctx
 * @param {object} candidate the workspace loaded with the new workspace.json
 * @returns {Array<{ path: string, message: string }>}
 */
export function clearanceErrors(ctx, candidate) {
  const mineName = ctx.user?.clearance ?? 'Confidential';
  const mine = CLEARANCES.indexOf(mineName);
  const rank = (c) => CLEARANCES.indexOf(c);
  const listedBefore = new Set(Object.keys(ctx.ws.config.users ?? {}));
  const ids = new Set([...listedBefore, ...Object.keys(candidate.config.users ?? {})]);
  if (ctx.user?.id) ids.add(ctx.user.id);
  const errors = [];
  for (const uid of [...ids].sort()) {
    const before = clearanceFor(ctx.ws, uid);
    const after = clearanceFor(candidate, uid);
    const removed = listedBefore.has(uid) && !Object.hasOwn(candidate.config.users ?? {}, uid);
    const path = `users.${uid}.clearance`;
    const listedNow = !listedBefore.has(uid) && Object.hasOwn(candidate.config.users ?? {}, uid);
    if ((after !== before || listedNow) && rank(after) > mine) {
      const hint = removed || after === 'Confidential' ? ' (a removed, unlisted or blank user is Confidential)' : '';
      errors.push({ path, message: `would give ${uid} clearance ${after}${hint}: above your own clearance (${mineName})` });
    } else if (listedBefore.has(uid) && rank(before) > mine && (after !== before || removed)) {
      errors.push({ path, message: `cannot ${removed ? 'remove' : 'change'} a user with clearance ${before}: above your own clearance (${mineName})` });
    }
  }
  return errors;
}
