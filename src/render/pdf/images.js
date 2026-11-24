// Image preparation with sharp (same pipeline as the legacy scripts) plus an in-memory cache.
import { statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
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
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, split: object|null }>} `split` holds the
 *   deflated colour/alpha planes when the image has transparency (used by placeImage).
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
      .then(async ({ data, info }) => Object.freeze({
        buffer: data, width: info.width, height: info.height, split: info.channels % 2 === 0 ? await splitAlpha(data) : null,
      }));
    hit.catch(() => cache.delete(key));
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Colour and alpha planes of an image with transparency, each deflated. pdfkit splits such PNGs itself, but on an
 * asynchronous inflate whose completion order decides object numbers, so two renders could differ; embedding the
 * planes ourselves keeps the output byte-stable.
 */
async function splitAlpha(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const colors = info.channels - 1;
  const pixels = info.width * info.height;
  const color = Buffer.alloc(pixels * colors);
  const alpha = Buffer.alloc(pixels);
  for (let i = 0, p = 0, a = 0; a < pixels; a++) {
    for (let c = 0; c < colors; c++) color[p++] = data[i++];
    alpha[a] = data[i++];
  }
  return { colors, color: deflateSync(color), alpha: deflateSync(alpha) };
}

/** A pdfkit-compatible image object that writes pre-split colour + SMask planes synchronously. */
class SplitImage {
  constructor(img, label) {
    this.width = img.width;
    this.height = img.height;
    this.label = label;
    this.split = img.split;
    this.obj = null;
  }

  embed(document) {
    const { width: Width, height: Height, split } = this;
    this.obj = document.ref({
      Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, Width, Height, Filter: 'FlateDecode',
      ColorSpace: split.colors === 1 ? 'DeviceGray' : 'DeviceRGB',
    });
    const sMask = document.ref({
      Type: 'XObject', Subtype: 'Image', Height, Width, BitsPerComponent: 8, Filter: 'FlateDecode', ColorSpace: 'DeviceGray', Decode: [0, 1],
    });
    sMask.end(split.alpha);
    this.obj.data.SMask = sMask;
    this.obj.end(split.color);
  }
}

/**
 * Draw a prepared image (from loadImage) with pdfkit's `doc.image` options. Each image is embedded once per document
 * and reused on later pages.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ buffer: Buffer, width: number, height: number, split: object|null }} img
 * @param {number} x @param {number} y @param {object} [options] e.g. `{ height }` or `{ width }`
 */
export function placeImage(ctx, img, x, y, options = {}) {
  const { doc } = ctx;
  ctx._images ??= new Map();
  let pdfImage = ctx._images.get(img);
  if (!pdfImage) {
    pdfImage = img.split ? new SplitImage(img, `DI${(ctx._imageSeq = (ctx._imageSeq ?? 0) + 1)}`) : doc.openImage(img.buffer);
    ctx._images.set(img, pdfImage);
  }
  doc.image(pdfImage, x, y, options);
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
    seal: (opts = {}) => loadImage(brandAsset(ws, brandId, 'assets.seal'), { trim: true, resizeWidth: 600, ...opts }),
    signature: (signatoryId, { variant = 'large', ...opts } = {}) => {
      const key = variant === 'compact' ? `signature:${signatoryId}` : `signature-large:${signatoryId}`;
      return loadImage(brandAsset(ws, brandId, key), { flattenWhite: true, ...opts });
    },
  });
}
