// Files the pages and HTML renditions reference: brand images and fonts (resolved through brandAsset), draft
// previews, and stored blobs (through a document the user may read). Nothing else in the workspace is served.
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { brandAsset } from '../../workspace/index.js';
import { FONT_WEIGHTS } from '../../workspace/schemas.js';
import { readBlobForUser } from '../../services/documents.js';
import { DossierError } from '../../errors.js';
import { sendFile } from '../http.js';

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

function sendAsset(reply, file) {
  reply.header('Cache-Control', 'private, max-age=300');
  return sendFile(reply, { buffer: readFileSync(file), filename: basename(file), mime: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function assetRoutes(app, { ctx }) {
  app.get('/assets/brands/:brandId/logo', (req, reply) => sendAsset(reply, assetFile(ctx, req.params.brandId, 'assets.logo')));

  app.get('/assets/brands/:brandId/signatures/:signatoryId', (req, reply) => {
    const { brandId, signatoryId } = req.params;
    return sendAsset(reply, assetFile(ctx, brandId, `signature:${signatoryId}`));
  });

  // The HTML renderer links a brand font by its file name; a weight name (`bold`) works too.
  app.get('/assets/brands/:brandId/fonts/:font', (req, reply) => {
    const { brandId, font } = req.params;
    if (FONT_WEIGHTS.includes(font)) return sendAsset(reply, assetFile(ctx, brandId, `font:${font}`));
    for (const w of FONT_WEIGHTS) {
      const file = assetFile(ctx, brandId, `font:${w}`);
      if (basename(file) === font) return sendAsset(reply, file);
    }
    throw notFound(`font "${font}" for brand "${brandId}"`);
  });

  // Draft previews written by previewDocument: <dataDir>/previews/<token>/preview.<ext>, read only.
  app.get('/previews/:token/:file', (req, reply) => {
    const { token, file } = req.params;
    if (!/^[0-9a-f]{64}$/.test(token) || !/^preview\.(pdf|html|md)$/.test(file)) throw notFound('preview');
    const path = join(ctx.config.dataDir, 'previews', token, file);
    if (!existsSync(path)) throw notFound('preview');
    return sendFile(reply, { buffer: readFileSync(path), filename: file, mime: MIME[extname(file)] });
  });

  // Blobs only through a rendition of a document the user may read (FORBIDDEN otherwise).
  app.get('/blobs/:sha256/:filename', (req, reply) => {
    const out = readBlobForUser(ctx, req.params.sha256, { filename: req.params.filename });
    return sendFile(reply, out, { download: req.query.download !== undefined });
  });
}
