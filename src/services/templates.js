// Template registry: built-in templates (src/templates) + extra folders + workspace templates (same id overrides).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DossierError } from '../errors.js';
import { nowIso } from '../db/index.js';
import { REPO_ROOT } from '../paths.js';
import { parseSource, validateTemplateMeta } from '../workspace/templateSchema.js';
import { memoOf, WS } from '../cache/memo.js';

/** Folder of the templates shipped with Dossier. */
export const BUILTIN_TEMPLATES_DIR = join(REPO_ROOT, 'src', 'templates');

/** Named bodies: `body.<name>.md` next to `body.md` (selected by a `variant` value, see the generator). */
const NAMED_BODY = /^body\.([a-z0-9][a-z0-9_-]*)\.md$/;

/**
 * Files that make up a template, in hash order: template.json, body.md, the named bodies `body.<name>.md` (sorted),
 * then every `*.js` file in the folder (sub-folders included, sorted by relative path).
 */
function templateFiles(dir) {
  const bodies = readdirSync(dir).filter((f) => NAMED_BODY.test(f)).sort();
  const js = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.js') && !f.split(/[\\/]/).includes('node_modules') && statSync(join(dir, f)).isFile())
    .map((f) => f.split(sep).join('/'))
    .sort();
  return ['template.json', 'body.md', ...bodies, ...js];
}

/** Read a template folder's files and hash them. */
function readFiles(dir) {
  const hash = createHash('sha256');
  const files = {};
  for (const f of templateFiles(dir)) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    files[f] = readFileSync(p);
    hash.update(`${f}\u0000${files[f].length}\u0000`).update(files[f]);
  }
  const bodies = {};
  for (const f of Object.keys(files)) {
    const m = NAMED_BODY.exec(f);
    if (m) bodies[m[1]] = files[f].toString('utf8');
  }
  return { files, bodies, digest: hash.digest('hex') };
}

/** Loaded modules by `<path>#<hash>`, so an unchanged template is imported once per process. */
const moduleCache = new Map();

/**
 * @typedef {object} TemplateEntry
 * @property {string} id
 * @property {number} version
 * @property {string} type
 * @property {string} title
 * @property {string} category
 * @property {'builtin'|'workspace'} source
 * @property {string} path absolute folder
 * @property {string} hash sha256 over template.json, body.md, the named bodies and every .js file in the folder; for a
 *   workspace override that inherits, a sha256 over its own files' hash and the built-in template's hash
 * @property {object} meta validated template.json
 * @property {string} [inherits] folder of the built-in template whose module (and meta/bodies) this override reuses
 */

const invalid = (rel, detail, extra = {}) => new DossierError('TEMPLATE_INVALID', `${rel}: ${detail}`, { file: rel, ...extra });

/** Template folders in precedence order (later wins): built-ins, config/extra dirs, then the workspace. */
function sources(ctx, dirs) {
  const extra = dirs ?? ctx.templateDirs ?? ctx.config?.templateDirs ?? [];
  return [
    { dir: BUILTIN_TEMPLATES_DIR, source: 'builtin' },
    ...extra.map((d) => ({ dir: resolve(d), source: 'builtin' })),
    { dir: ctx.ws.templatesDir, source: 'workspace' },
  ];
}

function parseMeta(ctx, rel, name, buf) {
  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw invalid(rel, `invalid JSON (${e.message})`);
  }
  const r = validateTemplateMeta(json);
  if (r.error) throw invalid(rel, `invalid:\n${r.error.replace(/^/gm, '  ')}`, { issues: r.error });
  const meta = r.data;
  if (meta.id !== name) throw invalid(rel, `id "${meta.id}" must match the folder name "${name}"`);
  if (meta.numbering && meta.numbering.series !== 'brand' && !ctx.ws.series.has(meta.numbering.series)) {
    throw invalid(rel, `numbering.series: unknown series "${meta.numbering.series}" (not in series.json)`);
  }
  return meta;
}

const entryOf = (meta, rest) => ({
  id: meta.id, version: meta.version, type: meta.type, title: meta.title, category: meta.category, meta, ...rest,
});

/**
 * Load one template folder. A workspace folder without `index.js` whose id an earlier folder (`base`, a built-in or
 * extra folder) already provides inherits from it: the base module, the base meta unless the folder has its own
 * `template.json` (which then replaces it whole), and the base bodies unless the folder has its own (file by file).
 */
function readFolder(ctx, folder, name, source, base) {
  const rel = `${source === 'workspace' ? 'templates' : folder}/${name}/template.json`;
  const dir = join(folder, name);
  const { files, bodies, digest } = readFiles(dir);
  const inherit = source === 'workspace' && base && !files['index.js'];
  if (!inherit) {
    if (!files['template.json']) {
      throw invalid(rel, base
        ? `index.js without template.json: an override with its own index.js needs its own template.json (remove index.js to inherit the built-in "${name}")`
        : `no template.json and no built-in template "${name}" to inherit from`);
    }
    const meta = parseMeta(ctx, rel, name, files['template.json']);
    if (!files['index.js'] && !files['body.md']) throw invalid(rel, 'a template needs index.js or body.md');
    return entryOf(meta, {
      source, path: dir, hash: digest, hasModule: Boolean(files['index.js']), modulePath: dir, moduleHash: digest,
      body: files['body.md']?.toString('utf8'), bodies,
    });
  }
  if (base.error) throw invalid(rel, `inherits from a built-in template that does not load: ${base.error.message}`);
  const meta = files['template.json'] ? parseMeta(ctx, rel, name, files['template.json']) : base.meta;
  return entryOf(meta, {
    source, path: dir, inherits: base.path,
    hash: createHash('sha256').update(`inherits\u0000${digest}\u0000${base.hash}`).digest('hex'),
    hasModule: base.hasModule, modulePath: base.modulePath, moduleHash: base.moduleHash,
    body: files['body.md']?.toString('utf8') ?? base.body, bodies: { ...base.bodies, ...bodies },
  });
}

/** True when a folder holds template files other than template.json (a likely override or a typo). */
const hasTemplateFiles = (folder) => readdirSync(folder).some((f) => f === 'index.js' || f === 'body.md' || NAMED_BODY.test(f));

/**
 * A cheap signature of the template folders: relative path, size and mtime of every file and folder below each
 * source folder (no file is read). A changed signature makes `scan` read and validate the folders again.
 */
function foldersFingerprint(list) {
  const parts = [];
  for (const { dir, source } of list) {
    parts.push(`${source}:${dir}`);
    if (!existsSync(dir)) continue;
    for (const rel of readdirSync(dir, { recursive: true }).map(String).sort()) {
      if (rel.split(/[\\/]/).includes('node_modules')) continue;
      try {
        const st = statSync(join(dir, rel));
        parts.push(`${rel}:${st.isDirectory() ? 'd' : st.size}:${st.mtimeMs}`);
      } catch {
        parts.push(`${rel}:-`);
      }
    }
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/**
 * Map of template id -> entry, or `{ id, source, path, error }` (a DossierError) when that folder does not load.
 * A broken folder replaces what it would override: requesting its id fails instead of silently using the built-in.
 * Memoised per context on the folders' fingerprint, the workspace configuration (series) and the `templates` table
 * version; the entries are shared, so callers copy what they hand out.
 */
function scan(ctx, dirs) {
  const list = sources(ctx, dirs);
  return memoOf(ctx)(`templates\u0000${foldersFingerprint(list)}`, ['templates', WS], () => scanFolders(ctx, list));
}

function scanFolders(ctx, list) {
  const found = new Map();
  for (const { dir, source } of list) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const folder = join(dir, name);
      if (!statSync(folder).isDirectory()) continue;
      const base = found.get(name);
      if (!existsSync(join(folder, 'template.json')) && !(source === 'workspace' && (base || hasTemplateFiles(folder)))) continue;
      try {
        found.set(name, readFolder(ctx, dir, name, source, base));
      } catch (error) {
        found.set(name, { id: name, source, path: folder, error });
      }
    }
  }
  return found;
}

const errorEntry = ({ id, source, path, error }) => ({
  id, source, path, code: error.code ?? 'TEMPLATE_INVALID', message: error.message, details: error.details ?? {},
});

/** Upsert the registry rows (`templates` table) of templates whose source, path or hash changed. */
function register(ctx, entries) {
  const { db, repo } = ctx;
  repo.tx(() => {
    for (const t of entries) {
      const before = db.prepare('SELECT id, version, source, path, hash FROM templates WHERE id = ? AND version = ?').get(t.id, t.version);
      if (before && before.hash === t.hash && before.source === t.source && before.path === t.path) continue;
      db.prepare(
        'INSERT INTO templates (id, version, source, path, hash, meta_json, loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?) '
        + 'ON CONFLICT(id, version) DO UPDATE SET source = excluded.source, path = excluded.path, hash = excluded.hash, '
        + 'meta_json = excluded.meta_json, loaded_at = excluded.loaded_at',
      ).run(t.id, t.version, t.source, t.path, t.hash, JSON.stringify(t.meta), nowIso());
      const after = { id: t.id, version: t.version, source: t.source, path: t.path, hash: t.hash };
      repo.audit(before ? 'template.update' : 'template.register', 'template', `${t.id}@${t.version}`, before ? { ...before } : null, after);
      repo.bump('templates');
    }
  });
}

const publicEntry = ({ hasModule, body, bodies, modulePath, moduleHash, ...rest }) => ({ ...rest, meta: structuredClone(rest.meta) });

/**
 * Every available template: built-ins, then extra folders (`opts.dirs`, else `ctx.templateDirs`, else
 * `ctx.config.templateDirs` from DOSSIER_TEMPLATE_DIRS), then the workspace's `templates/`; a later folder with the
 * same id overrides an earlier one. Registry rows are upserted with the content hash. Folders that fail to load are
 * left out (see listTemplateErrors); they never break the other templates.
 * @param {object} ctx
 * @param {{ dirs?: string[] }} [opts]
 * @returns {TemplateEntry[]} sorted by id
 */
export function listTemplates(ctx, { dirs } = {}) {
  const entries = [...scan(ctx, dirs).values()].filter((t) => !t.error).sort((a, b) => (a.id < b.id ? -1 : 1));
  register(ctx, entries);
  return entries.map(publicEntry);
}

/**
 * Template folders that failed to load (bad JSON, schema errors, unknown series…), which listTemplates leaves out.
 * @param {object} ctx
 * @param {{ dirs?: string[] }} [opts]
 * @returns {Array<{ id: string, source: string, path: string, code: string, message: string, details: object }>}
 */
export function listTemplateErrors(ctx, { dirs } = {}) {
  return [...scan(ctx, dirs).values()].filter((t) => t.error).sort((a, b) => (a.id < b.id ? -1 : 1)).map(errorEntry);
}

/**
 * Load one template: validated meta, its `index.js` module (an empty object when the template only has body.md),
 * `body.md` text and hash. Throws TEMPLATE_NOT_FOUND, or TEMPLATE_INVALID when this template's folder does not load
 * or a `computed:` field names a function the module does not export (other broken folders do not matter).
 * Changing a helper `.js` next to index.js changes the hash, but Node caches ES modules: index.js is re-imported,
 * helpers it imports are not until the process restarts.
 * @param {object} ctx
 * @param {string} id
 * @param {{ dirs?: string[] }} [opts]
 * A workspace override without index.js uses the built-in module (see readFolder); `bodies` maps the names of
 * `body.<name>.md` files to their text.
 * @returns {Promise<{ id: string, meta: object, module: object, body?: string, bodies?: Record<string, string>,
 *   hash: string, source: string, path: string, inherits?: string }>}
 */
export async function getTemplate(ctx, id, { dirs } = {}) {
  const found = scan(ctx, dirs);
  const t = found.get(id);
  if (!t) throw new DossierError('TEMPLATE_NOT_FOUND', `No template "${id}"`, { id, known: [...found.keys()].sort() });
  if (t.error) throw t.error;
  register(ctx, [t]);
  let module = {};
  if (t.hasModule) {
    const key = `${t.modulePath}#${t.moduleHash}`;
    if (!moduleCache.has(key)) {
      const url = `${pathToFileURL(join(t.modulePath, 'index.js')).href}?v=${t.moduleHash.slice(0, 16)}`;
      const loading = import(url);
      loading.catch(() => moduleCache.delete(key));
      moduleCache.set(key, loading);
    }
    try {
      module = await moduleCache.get(key);
    } catch (e) {
      throw invalid(`${t.modulePath}/index.js`, `cannot load module (${e.message})`);
    }
  }
  t.meta.fields.forEach((f, i) => {
    const src = parseSource(f.source);
    if (src.kind === 'computed' && typeof module.computed?.[src.arg] !== 'function') {
      throw invalid(`${t.path}/template.json`, `fields.${i}.source: index.js exports no computed.${src.arg}()`);
    }
  });
  const out = { id: t.id, meta: structuredClone(t.meta), module, hash: t.hash, source: t.source, path: t.path };
  if (t.inherits) out.inherits = t.inherits;
  if (t.body !== undefined) out.body = t.body;
  if (Object.keys(t.bodies).length) out.bodies = { ...t.bodies };
  return out;
}
