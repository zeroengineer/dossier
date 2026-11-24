// Image preparation with sharp (same pipeline as the legacy scripts) plus an in-memory cache.
import { statSync } from 'node:fs';
import sharp from 'sharp';
import { brandAsset } from '../../workspace/index.js';

const cache = new Map();
const CACHE_MAX = 64;

/**
 * Load and prepare an image: optional `trim`, `resize({ height | width })`, `flatten` on white, then PNG with fixed
 * encoder settings so the bytes are reproducible. Width/height are those of the prepared image, so callers size by
 * aspect ratio from the real image.
 * Cached in memory by path + mtime + size + options.
 * @param {string} path
 * @param {{ resizeHeight?: number, resizeWidth?: number, trim?: boolean, flattenWhite?: boolean }} [opts]
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export function loadImage(path, opts = {}) {
  const { resizeHeight, resizeWidth, trim = false, flattenWhite = false } = opts;
  const st = statSync(path);
  const key = JSON.stringify([path, st.mtimeMs, st.size, resizeHeight ?? null, resizeWidth ?? null, !!trim, !!flattenWhite]);
  let hit = cache.get(key);
  if (!hit) {
    let img = sharp(path);
    if (trim) img = img.trim();
    if (resizeHeight || resizeWidth) img = img.resize({ height: resizeHeight, width: resizeWidth });
    if (flattenWhite) img = img.flatten({ background: '#ffffff' });
    hit = img.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => Object.freeze({ buffer: data, width: info.width, height: info.height }));
    hit.catch(() => cache.delete(key));
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, hit);
  }
  return hit;
}

/** Drop every cached image (tests, or after brand assets change). */
export function clearImageCache() {
  cache.clear();
}

/**
 * Brand image accessors bound to one brand: `logo(opts)`, `seal(opts)` (default trim + width 600, as the letter
 * family), `signature(signatoryId, { variant: 'large'|'compact', ...opts })` (default flattened on white).
 * @param {object} ws loaded workspace
 * @param {string} brandId
 */
export function brandImages(ws, brandId) {
  return Object.freeze({
    logo: (opts = {}) => loadImage(brandAsset(ws, brandId, 'assets.logo'), opts),
    seal: (opts = { trim: true, resizeWidth: 600 }) => loadImage(brandAsset(ws, brandId, 'assets.seal'), opts),
    signature: (signatoryId, { variant = 'large', ...opts } = {}) => {
      const key = variant === 'compact' ? `signature:${signatoryId}` : `signature-large:${signatoryId}`;
      return loadImage(brandAsset(ws, brandId, key), { flattenWhite: true, ...opts });
    },
  });
}
