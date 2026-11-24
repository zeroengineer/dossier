// Template registry: built-in templates (src/templates) + extra folders + workspace templates (same id overrides).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DossierError } from '../errors.js';
import { nowIso } from '../db/index.js';
import { REPO_ROOT } from '../paths.js';
import { parseSource, validateTemplateMeta } from '../workspace/templateSchema.js';

/** Folder of the templates shipped with Dossier. */
export const BUILTIN_TEMPLATES_DIR = join(REPO_ROOT, 'src', 'templates');

/** Files that make up a template; their bytes (in this order) form the template hash. */
const TEMPLATE_FILES = ['template.json', 'index.js', 'body.md'];

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
 * @property {string} hash sha256 over template.json, index.js and body.md bytes
 * @property {object} meta validated template.json
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

function readFolder(ctx, folder, name, source) {
  const rel = `${source === 'workspace' ? 'templates' : folder}/${name}/template.json`;
  const dir = join(folder, name);
  const hash = createHash('sha256');
  const files = {};
  for (const f of TEMPLATE_FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    files[f] = readFileSync(p);
    hash.update(`${f}\u0000${files[f].length}\u0000`).update(files[f]);
  }
  let json;
  try {
    json = JSON.parse(files['template.json'].toString('utf8'));
  } catch (e) {
    throw invalid(rel, `invalid JSON (${e.message})`);
  }
  const r = validateTemplateMeta(json);
  if (r.error) throw invalid(rel, `invalid:\n${r.error.replace(/^/gm, '  ')}`, { issues: r.error });
  const meta = r.data;
  if (meta.id !== name) throw invalid(rel, `id "${meta.id}" must match the folder name "${name}"`);
  if (!files['index.js'] && !files['body.md']) throw invalid(rel, 'a template needs index.js or body.md');
  if (meta.numbering && meta.numbering.series !== 'brand' && !ctx.ws.series.has(meta.numbering.series)) {
    throw invalid(rel, `numbering.series: unknown series "${meta.numbering.series}" (not in series.json)`);
  }
  return {
    id: meta.id, version: meta.version, type: meta.type, title: meta.title, category: meta.category,
    source, path: dir, hash: hash.digest('hex'), meta,
    hasModule: Boolean(files['index.js']), body: files['body.md']?.toString('utf8'),
  };
}

function scan(ctx, dirs) {
  const found = new Map();
  for (const { dir, source } of sources(ctx, dirs)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const folder = join(dir, name);
      if (!statSync(folder).isDirectory() || !existsSync(join(folder, 'template.json'))) continue;
      found.set(name, readFolder(ctx, dir, name, source));
    }
  }
  return found;
}

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

const publicEntry = ({ hasModule, body, ...rest }) => rest;

/**
 * Every available template: built-ins, then extra folders (`opts.dirs`, else `ctx.templateDirs`, else
 * `ctx.config.templateDirs` from DOSSIER_TEMPLATE_DIRS), then the workspace's `templates/`; a later folder with the
 * same id overrides an earlier one. Registry rows are upserted with the content hash. Throws TEMPLATE_INVALID for a
 * folder whose template.json does not validate.
 * @param {object} ctx
 * @param {{ dirs?: string[] }} [opts]
 * @returns {TemplateEntry[]} sorted by id
 */
export function listTemplates(ctx, { dirs } = {}) {
  const entries = [...scan(ctx, dirs).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  register(ctx, entries);
  return entries.map(publicEntry);
}

/**
 * Load one template: validated meta, its `index.js` module (an empty object when the template only has body.md),
 * `body.md` text and hash. Throws TEMPLATE_NOT_FOUND or TEMPLATE_INVALID (also when a `computed:` field names a
 * function the module does not export).
 * @param {object} ctx
 * @param {string} id
 * @param {{ dirs?: string[] }} [opts]
 * @returns {Promise<{ id: string, meta: object, module: object, body?: string, hash: string, source: string, path: string }>}
 */
export async function getTemplate(ctx, id, { dirs } = {}) {
  const found = scan(ctx, dirs);
  const t = found.get(id);
  if (!t) throw new DossierError('TEMPLATE_NOT_FOUND', `No template "${id}"`, { id, known: [...found.keys()].sort() });
  register(ctx, [t]);
  let module = {};
  if (t.hasModule) {
    const key = `${t.path}#${t.hash}`;
    if (!moduleCache.has(key)) {
      const url = `${pathToFileURL(join(t.path, 'index.js')).href}?v=${t.hash.slice(0, 16)}`;
      const loading = import(url);
      loading.catch(() => moduleCache.delete(key));
      moduleCache.set(key, loading);
    }
    try {
      module = await moduleCache.get(key);
    } catch (e) {
      throw invalid(`${t.path}/index.js`, `cannot load module (${e.message})`);
    }
  }
  t.meta.fields.forEach((f, i) => {
    const src = parseSource(f.source);
    if (src.kind === 'computed' && typeof module.computed?.[src.arg] !== 'function') {
      throw invalid(`${t.path}/template.json`, `fields.${i}.source: index.js exports no computed.${src.arg}()`);
    }
  });
  const out = { id: t.id, meta: t.meta, module, hash: t.hash, source: t.source, path: t.path };
  if (t.body !== undefined) out.body = t.body;
  return out;
}
