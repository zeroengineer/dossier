// Files the pages and HTML renditions reference: brand images and fonts (resolved through brandAsset), draft
// previews, and stored blobs (through a document the user may read). Nothing else in the workspace is served.
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { brandAsset } from '../../workspace/index.js';
import { FONT_WEIGHTS } from '../../workspace/schemas.js';
import { readBlobForUser } from '../../services/documents.js';
import { DossierError } from '../../errors.js';
import { fileHash } from '../../cache/renderCache.js';
import { CACHE_PRIVATE_IMMUTABLE, CACHE_PUBLIC_IMMUTABLE, sendFile } from '../http.js';

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.pdf': 'application/pdf', '.html': 'text/html', '.md': 'text/markdown',
};
const notFound = (what) => new DossierError('ASSET_NOT_FOUND', `No ${what}`, {});

/** Resolve a brand asset key to a file, turning unknown brands/signatories into ASSET_NOT_FOUND. */
function assetFile(ctx, brandId, key) {
  if (!ctx.ws.brands.has(brandId)) throw notFound(`brand "${brandId}"`);
  let file;
  try {
    file = brandAsset(ctx.ws, brandId, key);
  } catch {
    throw notFound(`asset ${key} for brand "${brandId}"`);
  }
  if (!file || !existsSync(file)) throw notFound(`asset ${key} for brand "${brandId}"`);
  return file;
}

/**
 * Send a brand asset with `ETag` = the file's sha256. The URL names a slot (logo, a signatory, a font weight), not the
 * content, so it is only cached for good (`public, immutable`) when the request carries `?v=` with a prefix (12 or
 * more hex digits) of that hash, as the pages emit; otherwise browsers revalidate (`public, no-cache`, then 304).
 */
function sendAsset(req, reply, file) {
  const hash = fileHash(file);
  const v = typeof req.query.v === 'string' ? req.query.v.toLowerCase() : '';
  const pinned = /^[0-9a-f]{12,64}$/.test(v) && hash.startsWith(v);
  return sendFile(reply, { buffer: readFileSync(file), filename: basename(file), mime: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' },
    { req, etag: hash, cacheControl: pinned ? CACHE_PUBLIC_IMMUTABLE : 'public, no-cache' });
}

/**
 * Version tag for a brand asset URL (`?v=`): the first 12 hex digits of the file's sha256, or null when the asset
 * does not resolve to a file.
 * @param {object} ctx
 * @param {string} brandId
 * @param {string} key brandAsset key, e.g. `assets.logo`
 * @returns {string|null}
 */
export function assetVersion(ctx, brandId, key) {
  try {
    const file = brandAsset(ctx.ws, brandId, key);
    return file ? fileHash(file)?.slice(0, 12) ?? null : null;
  } catch {
    return null;
  }
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function assetRoutes(app, { ctx }) {
  app.get('/assets/brands/:brandId/logo', (req, reply) => sendAsset(req, reply, assetFile(ctx, req.params.brandId, 'assets.logo')));

  app.get('/assets/brands/:brandId/seal', (req, reply) => sendAsset(req, reply, assetFile(ctx, req.params.brandId, 'assets.seal')));
  app.get('/assets/brands/:brandId/watermark', (req, reply) => sendAsset(req, reply, assetFile(ctx, req.params.brandId, 'assets.watermark')));

  app.get('/assets/brands/:brandId/signatures-large/:signatoryId', (req, reply) => {
    const { brandId, signatoryId } = req.params;
    return sendAsset(req, reply, assetFile(ctx, brandId, `signature-large:${signatoryId}`));
  });

  app.get('/assets/brands/:brandId/signatures/:signatoryId', (req, reply) => {
    const { brandId, signatoryId } = req.params;
    return sendAsset(req, reply, assetFile(ctx, brandId, `signature:${signatoryId}`));
  });

  // The HTML renderer links a brand font by its file name; a weight name (`bold`) works too.
  app.get('/assets/brands/:brandId/fonts/:font', (req, reply) => {
    const { brandId, font } = req.params;
    if (FONT_WEIGHTS.includes(font)) return sendAsset(req, reply, assetFile(ctx, brandId, `font:${font}`));
    for (const w of FONT_WEIGHTS) {
      const file = assetFile(ctx, brandId, `font:${w}`);
      if (basename(file) === font) return sendAsset(req, reply, file);
    }
    throw notFound(`font "${font}" for brand "${brandId}"`);
  });

  // Draft previews written by previewDocument: <dataDir>/previews/<token>/preview.<ext>, read only.
  app.get('/previews/:token/:file', (req, reply) => {
    const { token, file } = req.params;
    if (!/^[0-9a-f]{64}$/.test(token) || !/^preview\.(pdf|html|md)$/.test(file)) throw notFound('preview');
    const path = join(ctx.config.dataDir, 'previews', token, file);
    if (!existsSync(path)) throw notFound('preview');
    // The token names the draft's input, not its bytes (a preview made on another day differs), so revalidate.
    return sendFile(reply, { buffer: readFileSync(path), filename: file, mime: MIME[extname(file)] },
      { req, etag: fileHash(path), cacheControl: 'private, no-cache' });
  });

  // Blobs only through a rendition of a document the user may read (FORBIDDEN otherwise, also for a conditional
  // request: the check runs before the 304). Content-addressed, so cached for good, but only privately: a shared
  // cache must never hand a gated file to another user.
  app.get('/blobs/:sha256/:filename', (req, reply) => {
    const out = readBlobForUser(ctx, req.params.sha256, { filename: req.params.filename });
    return sendFile(reply, out, { download: req.query.download !== undefined, req, etag: out.sha256, cacheControl: CACHE_PRIVATE_IMMUTABLE });
  });
}
