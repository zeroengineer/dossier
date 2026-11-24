// Settings: overview, brand editor (sections, asset uploads, preview, download), series and workspace editors, and
// the JSON API for the same files. Writes go through src/services/workspaceFiles.js.
import { DossierError, isDossierError } from '../../errors.js';
import {
  ASSET_MAX_BYTES, brandRel, builtinFonts, getBrandFile, getSeriesFile, getWorkspaceFile, seriesUsage, storeBrandAsset, writeBrand, writeSeries, writeWorkspaceConfig,
} from '../../services/workspaceFiles.js';
import { renderBrandPreview } from '../../render/brandPreview.js';
import { sep } from 'node:path';
import { PLACEHOLDERS_DIR } from '../../paths.js';
import { brandAsset, missingBrandAssets } from '../../workspace/index.js';
import { FONT_WEIGHTS } from '../../workspace/schemas.js';
import { applyBrandSection, BRAND_SECTIONS, newBrandBody, seriesFromForm, workspaceFromForm } from '../settingsForms.js';
import { brandPage, brandsPage, seriesPage, settingsPage, workspacePage } from '../views/settings.js';
import { errorReply, readMultipart, seeOther, sendFile, sendPage, shellOf } from '../http.js';
import { assetVersion } from './assets.js';

/** Read an asset upload with the asset size limit; a larger file is ASSET_TOO_LARGE. */
async function readAssetUpload(req) {
  try {
    return await readMultipart(req, { limits: { fileSize: ASSET_MAX_BYTES } });
  } catch (err) {
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new DossierError('ASSET_TOO_LARGE', `Assets are limited to ${ASSET_MAX_BYTES / 1024 / 1024} MB`, { max: ASSET_MAX_BYTES });
    }
    throw err;
  }
}

/** Served URL of a brand asset slot (see src/web/routes/assets.js), without `?v=`. */
function assetPath(brandId, key) {
  const b = `/assets/brands/${encodeURIComponent(brandId)}`;
  const [kind, arg] = key.split(':');
  if (key === 'assets.logo') return `${b}/logo`;
  if (key === 'assets.seal') return `${b}/seal`;
  if (key === 'assets.watermark') return `${b}/watermark`;
  if (kind === 'signature') return `${b}/signatures/${encodeURIComponent(arg)}`;
  if (kind === 'signature-large') return `${b}/signatures-large/${encodeURIComponent(arg)}`;
  return `${b}/fonts/${arg}`;
}

const DEFAULT_SEAL = 'assets/seal.png';
const isPlaceholder = (file) => file.startsWith(`${PLACEHOLDERS_DIR}${sep}`);

/**
 * Every asset slot of a brand, in a stable order: `assets.logo`, `assets.seal`, `assets.watermark`, then
 * `signature:<id>` and `signature-large:<id>` per signatory, then `font:<weight>` for each FONT_WEIGHTS entry. Each
 * slot reports what the renderer (brandAsset) actually uses:
 * - `source`: `configured` (the brand's own file at the path it names; a valid `builtin:` font counts), `default` (seal
 *   unset, but `assets/seal.png` exists in the brand folders), `fallback` (a large signature with no `signatureLarge`
 *   that uses the signatory's signature, or a font whose spec is missing/invalid and falls back to built-in Manrope),
 *   `placeholder` (the shipped placeholder image), or null (a watermark that is unset or missing: nothing is drawn).
 * - `path`: the brand-relative path of the file used when `source` is configured, default, or a large-signature
 *   fallback (the signature's path); otherwise the configured value that did not resolve (null when unset).
 * - `present`: `source` is configured or default, i.e. the brand provides the file itself.
 * - `version`: the first 12 hex digits of the sha256 of the file served for the slot (also for a placeholder or a
 *   fallback), null when nothing is served. `url`: the served URL, pinned with `?v=<version>` when there is a version.
 * @param {object} ctx
 * @param {string} brandId a known brand
 * @returns {Array<{ key: string, path: string|null, source: 'configured'|'default'|'fallback'|'placeholder'|null,
 *   present: boolean, version: string|null, url: string }>}
 */
function brandAssetList(ctx, brandId) {
  const brand = ctx.ws.brands.get(brandId);
  const missing = new Set(missingBrandAssets(ctx.ws, brandId).map((m) => m.key));
  /** 'own' (a non-placeholder file), 'placeholder', or null (nothing). */
  const resolves = (key) => {
    const file = brandAsset(ctx.ws, brandId, key);
    if (!file) return null;
    return isPlaceholder(file) ? 'placeholder' : 'own';
  };
  const image = (key, configured, unsetDefault = null) => {
    const r = resolves(key);
    if (r !== 'own') return { path: configured ?? null, source: r };
    return configured ? { path: configured, source: 'configured' } : { path: unsetDefault, source: 'default' };
  };
  const slots = [
    ['assets.logo', () => image('assets.logo', brand.assets.logo)],
    ['assets.seal', () => image('assets.seal', brand.assets.seal, DEFAULT_SEAL)],
    ['assets.watermark', () => image('assets.watermark', brand.assets.watermark)],
    ...brand.signatories.flatMap((s) => [
      [`signature:${s.id}`, () => image(`signature:${s.id}`, s.signature)],
      [`signature-large:${s.id}`, () => {
        if (resolves(`signature-large:${s.id}`) !== 'own') return { path: s.signatureLarge ?? null, source: 'placeholder' };
        return s.signatureLarge ? { path: s.signatureLarge, source: 'configured' } : { path: s.signature, source: 'fallback' };
      }],
    ]),
    ...FONT_WEIGHTS.map((w) => [`font:${w}`, () => {
      const spec = brand.fonts[w] ?? null;
      return { path: spec, source: spec && !missing.has(`font:${w}`) ? 'configured' : 'fallback' };
    }]),
  ];
  return slots.map(([key, describe]) => {
    const { path, source } = describe();
    const version = source ? assetVersion(ctx, brandId, key) : null;
    const base = assetPath(brandId, key);
    return { key, path, source, present: source === 'configured' || source === 'default', version, url: version ? `${base}?v=${version}` : base };
  });
}

const fieldErrors = (err) => (isDossierError(err, 'WORKSPACE_INVALID') ? err.details.errors : null);

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function settingsRoutes(app, { ctx }) {
  app.get('/settings', (req, reply) => sendPage(reply, settingsPage({
    shell: shellOf(ctx),
    info: {
      home: ctx.config.home,
      dataDir: ctx.config.dataDir,
      workspace: ctx.ws.config.name,
      defaultBrand: ctx.ws.config.defaultBrand,
      user: ctx.user,
      brands: [...ctx.ws.brands.values()].map((b) => ({ id: b.id, name: b.legalName, signatories: (b.signatories ?? []).map((s) => `${s.name} (${s.id})`) })),
      series: [...ctx.ws.series.values()].map((s) => ({ id: s.id, pattern: s.pattern, scope: s.scope })),
    },
  })));

  // ----- brands

  const brandList = () => [...ctx.ws.brands.values()].map((b) => ({ id: b.id, legalName: b.legalName, inheritsFrom: b.inheritsFrom }));
  const listPage = (reply, values = {}, error = null, status = 200) => sendPage(reply, brandsPage({ shell: shellOf(ctx), brands: brandList(), values, error }), status);

  app.get('/settings/brands', (req, reply) => listPage(reply));

  app.post('/settings/brands', (req, reply) => {
    const values = req.body ?? {};
    try {
      const body = newBrandBody(values);
      writeBrand(ctx, body.id, body, { create: true });
      return seeOther(reply, `/settings/brands/${encodeURIComponent(body.id)}?saved=identity`);
    } catch (err) {
      if (!isDossierError(err)) throw err;
      const { status, body } = errorReply(err);
      return listPage(reply, values, body, status);
    }
  });

  const editorPage = (reply, id, extra = {}, status = 200) => {
    const b = getBrandFile(ctx, id);
    return sendPage(reply, brandPage({
      shell: shellOf(ctx),
      id,
      own: b.file,
      parent: b.parent,
      resolved: b.resolved,
      configHash: b.configHash,
      logoVersion: assetVersion(ctx, id, 'assets.logo'),
      seriesIds: [...ctx.ws.series.keys()],
      builtinFonts: builtinFonts(),
      ...extra,
    }), status);
  };

  app.get('/settings/brands/:id', (req, reply) => editorPage(reply, req.params.id, { saved: typeof req.query.saved === 'string' ? req.query.saved : null }));

  app.post('/settings/brands/:id', (req, reply) => {
    const { id } = req.params;
    const { file: own } = getBrandFile(ctx, id);
    const section = String(req.body?.$section ?? '');
    if (!BRAND_SECTIONS.includes(section)) throw new DossierError('INVALID_INPUT', `Unknown settings section "${section}"`, { section });
    const { body, errors } = applyBrandSection(own, section, req.body ?? {}, { inherits: Boolean(own.inheritsFrom) });
    try {
      if (errors.length) throw new DossierError('WORKSPACE_INVALID', 'Some fields are not valid', { file: brandRel(id), errors });
      writeBrand(ctx, id, body);
      return seeOther(reply, `/settings/brands/${encodeURIComponent(id)}?saved=${encodeURIComponent(section)}#sec-${section}`);
    } catch (err) {
      const list = fieldErrors(err);
      if (!list) throw err;
      return editorPage(reply, id, { own: body, errors: list, failedSection: section }, 400);
    }
  });

  app.post('/settings/brands/:id/assets', async (req, reply) => {
    const { id } = req.params;
    getBrandFile(ctx, id);
    try {
      const { file, fields } = await readAssetUpload(req);
      if (!file) throw new DossierError('INVALID_INPUT', 'Choose a file to upload');
      await storeBrandAsset(ctx, id, fields.key, file);
      return seeOther(reply, `/settings/brands/${encodeURIComponent(id)}?saved=upload`);
    } catch (err) {
      if (!isDossierError(err) || err.code === 'BRAND_NOT_FOUND') throw err;
      const list = fieldErrors(err);
      if (list) return editorPage(reply, id, { errors: list, failedSection: 'upload' }, 400);
      const { status, body } = errorReply(err);
      return editorPage(reply, id, { error: body }, status);
    }
  });

  // Old page routes and their /api/ replacements share these handlers (the /settings/ ones go with the old UI).
  const downloadBrandFile = (req, reply) => {
    const { id, file } = getBrandFile(ctx, req.params.id);
    return sendFile(reply, { buffer: Buffer.from(`${JSON.stringify(file, null, 2)}\n`), filename: `${id}.json`, mime: 'application/json' }, { download: true });
  };
  const sendBrandPreview = async (req, reply) => {
    const { id } = getBrandFile(ctx, req.params.id);
    const buffer = await renderBrandPreview(ctx.ws, id);
    return sendFile(reply, { buffer, filename: `${id}-preview.pdf`, mime: 'application/pdf' });
  };
  app.get('/settings/brands/:id/brand.json', downloadBrandFile);
  app.get('/settings/brands/:id/preview.pdf', sendBrandPreview);

  // ----- series

  const seriesView = (reply, extra = {}, status = 200) => sendPage(reply, seriesPage({ shell: shellOf(ctx), list: getSeriesFile(ctx), usage: seriesUsage(ctx), ...extra }), status);

  app.get('/settings/series', (req, reply) => seriesView(reply, { saved: req.query.saved !== undefined }));

  app.post('/settings/series', (req, reply) => {
    const { body, errors } = seriesFromForm(getSeriesFile(ctx), req.body ?? {});
    try {
      if (errors.length) throw new DossierError('WORKSPACE_INVALID', 'Some fields are not valid', { file: 'series.json', errors: errors.map((e) => ({ file: 'series.json', ...e })) });
      writeSeries(ctx, body);
      return seeOther(reply, '/settings/series?saved=1');
    } catch (err) {
      const list = fieldErrors(err);
      if (!list) throw err;
      return seriesView(reply, { list: body, errors: list }, 400);
    }
  });

  // ----- workspace.json

  const workspaceView = (reply, extra = {}, status = 200) => sendPage(reply, workspacePage({
    shell: shellOf(ctx), file: getWorkspaceFile(ctx), brandIds: [...ctx.ws.brands.keys()], ...extra,
  }), status);

  app.get('/settings/workspace', (req, reply) => workspaceView(reply, { saved: req.query.saved !== undefined }));

  app.post('/settings/workspace', (req, reply) => {
    const { body, errors } = workspaceFromForm(getWorkspaceFile(ctx), req.body ?? {});
    try {
      if (errors.length) throw new DossierError('WORKSPACE_INVALID', 'Some fields are not valid', { file: 'workspace.json', errors: errors.map((e) => ({ file: 'workspace.json', ...e })) });
      writeWorkspaceConfig(ctx, body);
      return seeOther(reply, '/settings/workspace?saved=1');
    } catch (err) {
      const list = fieldErrors(err);
      if (!list) throw err;
      return workspaceView(reply, { file: body, errors: list }, 400);
    }
  });

  // ----- JSON API

  const brandJson = (b) => ({ id: b.id, file: b.file, resolved: b.resolved, configHash: b.configHash });

  app.get('/api/brands', () => ({ brands: brandList() }));
  app.get('/api/brands/:id', (req) => brandJson(getBrandFile(ctx, req.params.id)));
  app.put('/api/brands/:id', (req, reply) => {
    const r = writeBrand(ctx, req.params.id, req.body);
    return reply.code(r.created ? 201 : 200).send(brandJson(r));
  });
  app.get('/api/brands/:id/assets', (req) => {
    const { id } = getBrandFile(ctx, req.params.id);
    return { assets: brandAssetList(ctx, id) };
  });
  app.get('/api/brands/:id/file', downloadBrandFile);
  app.get('/api/brands/:id/preview.pdf', sendBrandPreview);
  app.post('/api/brands/:id/assets/:key', async (req) => {
    const { id, key } = req.params;
    getBrandFile(ctx, id);
    const { file } = await readAssetUpload(req);
    if (!file) throw new DossierError('INVALID_INPUT', 'A multipart "file" part is required');
    const r = await storeBrandAsset(ctx, id, key, file);
    return { key: r.key, path: r.path, sha256: r.sha256, bytes: r.bytes, brand: brandJson(r) };
  });

  app.get('/api/series', () => ({ series: getSeriesFile(ctx) }));
  app.get('/api/series/usage', () => ({ usage: seriesUsage(ctx) }));
  app.put('/api/series', (req) => {
    const body = req.body;
    return { series: writeSeries(ctx, Array.isArray(body) ? body : body?.series) };
  });

  app.get('/api/workspace', () => ({ workspace: getWorkspaceFile(ctx) }));
  app.put('/api/workspace', (req) => {
    const body = req.body;
    return { workspace: writeWorkspaceConfig(ctx, body?.workspace ?? body) };
  });
}
