// Settings JSON API: brand files (assets, preview, download), series.json and workspace.json. Writes go through
// src/services/workspaceFiles.js.
import { DossierError } from '../../errors.js';
import {
  ASSET_MAX_BYTES, getBrandFile, getSeriesFileHashed, getWorkspaceFileHashed, normaliseExpectedHash, seriesUsage, storeBrandAsset,
  writeBrand, writeSeries, writeWorkspaceConfig,
} from '../../services/workspaceFiles.js';
import { renderBrandPreview } from '../../render/brandPreview.js';
import { sep } from 'node:path';
import { PLACEHOLDERS_DIR } from '../../paths.js';
import { brandAsset, missingBrandAssets } from '../../workspace/index.js';
import { FONT_WEIGHTS } from '../../workspace/schemas.js';
import { readMultipart, sendFile } from '../http.js';
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

/**
 * The expected file hash of a whole-file save: the `If-Match` request header, bare or quoted (see DECISIONS, "Optimistic
 * concurrency for settings saves"). Undefined when absent (no check, so the MCP and older clients keep working).
 * @param {import('fastify').FastifyRequest} req
 * @returns {string|undefined}
 */
const expectedHashOf = (req) => normaliseExpectedHash(req.headers['if-match']);

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function settingsRoutes(app, { ctx }) {
  const brandList = () => [...ctx.ws.brands.values()].map((b) => ({ id: b.id, legalName: b.legalName, inheritsFrom: b.inheritsFrom }));

  const downloadBrandFile = (req, reply) => {
    const { id, file } = getBrandFile(ctx, req.params.id);
    return sendFile(reply, { buffer: Buffer.from(`${JSON.stringify(file, null, 2)}\n`), filename: `${id}.json`, mime: 'application/json' }, { download: true });
  };
  const sendBrandPreview = async (req, reply) => {
    const { id } = getBrandFile(ctx, req.params.id);
    const buffer = await renderBrandPreview(ctx.ws, id);
    return sendFile(reply, { buffer, filename: `${id}-preview.pdf`, mime: 'application/pdf' });
  };

  const brandJson = (b) => ({ id: b.id, file: b.file, fileHash: b.fileHash, resolved: b.resolved, configHash: b.configHash });

  app.get('/api/brands', () => ({ brands: brandList() }));
  // Create only: an existing id is BRAND_DUPLICATE (409), never overwritten (PUT replaces).
  app.post('/api/brands', (req, reply) => {
    const body = req.body;
    const id = body !== null && typeof body === 'object' && !Array.isArray(body) ? body.id : undefined;
    const r = writeBrand(ctx, id, body, { create: true });
    return reply.code(201).send(brandJson(r));
  });
  app.get('/api/brands/:id', (req) => brandJson(getBrandFile(ctx, req.params.id)));
  app.put('/api/brands/:id', (req, reply) => {
    const r = writeBrand(ctx, req.params.id, req.body, { expectedHash: expectedHashOf(req) });
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
    return { key: r.key, path: r.path, sha256: r.sha256, bytes: r.bytes, fileHash: r.fileHash, brand: brandJson(r) };
  });

  app.get('/api/series', () => getSeriesFileHashed(ctx));
  app.get('/api/series/usage', () => ({ usage: seriesUsage(ctx) }));
  app.put('/api/series', (req) => {
    const body = req.body;
    writeSeries(ctx, Array.isArray(body) ? body : body?.series, { expectedHash: expectedHashOf(req) });
    return getSeriesFileHashed(ctx);
  });

  app.get('/api/workspace', () => getWorkspaceFileHashed(ctx));
  app.put('/api/workspace', (req) => {
    const body = req.body;
    writeWorkspaceConfig(ctx, body?.workspace ?? body, { expectedHash: expectedHashOf(req) });
    return getWorkspaceFileHashed(ctx);
  });
}
