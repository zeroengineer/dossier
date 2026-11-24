// PDF document set-up shared by every template: profile, fonts, pinned metadata, page hooks, output buffer.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { brandAsset, interpolate } from '../../workspace/index.js';
import { createFormatter } from './format.js';
import { brandImages } from './images.js';
import { getProfile } from './profiles.js';

const PDFDocument = createRequire(import.meta.url)('pdfkit');

/** Registration order is fixed: pdfkit's font subset tags derive from object ids. */
const FONT_NAMES = [
  ['Regular', 'regular'], ['Medium', 'medium'], ['SemiBold', 'semibold'], ['Bold', 'bold'], ['ExtraBold', 'extrabold'],
];
const OPTIONAL_FONTS = [['Light', 'light'], ['ExtraLight', 'extralight']];
const BODY_ALIASES = [['BodyRegular', 'regular'], ['BodyMedium', 'medium'], ['BodySemiBold', 'semibold'], ['BodyBold', 'bold']];

/** Name pinned into Producer/Creator. */
export const PRODUCER = 'Dossier';

/**
 * @typedef {object} PdfContext
 * @property {import('pdfkit')} doc
 * @property {ReturnType<typeof getProfile>} profile
 * @property {object} brand resolved brand
 * @property {object} ws loaded workspace
 * @property {Record<string, string>} palette brand palette (defaults filled)
 * @property {ReturnType<typeof createFormatter>} fmt
 * @property {ReturnType<typeof brandImages>} assets
 * @property {(key: string, scope?: object) => string} t brand string `strings[key]`, interpolated
 * @property {(str: string, scope?: object) => string} interp interpolate any text with the brand scope
 * @property {string} contact contact key used for `{contact.*}`
 * @property {number} pageNumber 1-based number of the current (last added) page
 */

/**
 * The interpolation scope for a brand: the brand itself plus `contact` (the named contact, falling back to `default`).
 * @param {object} brand @param {string} [contact]
 */
export function brandScope(brand, contact = 'default') {
  return { ...brand, contact: brand.contacts?.[contact] ?? brand.contacts?.default ?? {} };
}

/**
 * Create a pdfkit document for a brand and layout profile. Info dates are pinned to `creationDate` and Producer/Creator
 * to "Dossier", so the same input gives byte-identical output.
 * @param {{ profileId: string, brand: object|string, ws: object, contact?: string,
 *   info: { title: string, author?: string, subject?: string, creationDate: Date|string } }} opts
 * @returns {Promise<PdfContext>}
 */
export async function createPdf({ profileId, brand, ws, contact = 'default', info }) {
  if (typeof brand === 'string') {
    const b = ws.brands.get(brand);
    if (!b) throw new Error(`createPdf: unknown brand "${brand}"`);
    brand = b;
  }
  if (!info?.title) throw new Error('createPdf: info.title is required');
  const creationDate = info.creationDate instanceof Date ? info.creationDate : new Date(info.creationDate);
  if (Number.isNaN(creationDate.getTime())) throw new Error('createPdf: info.creationDate must be a valid date');

  const profile = getProfile(profileId, brand.layoutProfiles);
  const pdfInfo = { Title: info.title, Producer: PRODUCER, Creator: PRODUCER, CreationDate: creationDate, ModDate: creationDate };
  if (info.author) pdfInfo.Author = info.author;
  if (info.subject) pdfInfo.Subject = info.subject;

  const doc = new PDFDocument({
    size: [profile.PW, profile.PH],
    margins: { top: profile.MT, bottom: profile.MB, left: profile.ML, right: profile.MR },
    bufferPages: true,
    autoFirstPage: false,
    info: pdfInfo,
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  const font = (weight) => brandAsset(ws, brand.id, `font:${weight}`);
  for (const [name, weight] of FONT_NAMES) doc.registerFont(name, font(weight));
  for (const [name, weight] of OPTIONAL_FONTS) {
    const p = font(weight);
    if (existsSync(p)) doc.registerFont(name, p);
  }
  for (const [name, weight] of BODY_ALIASES) doc.registerFont(name, font(weight));

  const scope = brandScope(brand, contact);
  const ctx = {
    doc,
    profile,
    brand,
    ws,
    palette: brand.palette,
    fmt: createFormatter(ws.config?.locale),
    assets: brandImages(ws, brand.id),
    contact,
    pageNumber: 0,
    interp: (str, extra = {}) => interpolate(str, { ...scope, ...extra }),
    t: (key, extra = {}) => interpolate(brand.strings?.[key] ?? '', { ...scope, ...extra }),
    _chunks: chunks,
    _hooks: [],
  };
  doc.on('pageAdded', () => {
    ctx.pageNumber++;
    doc.page.dictionary.data.Rotate = 0;
  });
  return ctx;
}

/**
 * Register a `pageAdded` hook on the document (removed again by drawFooters / finalizePdf).
 * @param {PdfContext} ctx @param {() => void} fn
 */
export function onPageAdded(ctx, fn) {
  ctx.doc.on('pageAdded', fn);
  ctx._hooks.push(fn);
}

/** Remove every hook registered with onPageAdded (post-passes must not trigger headers). */
export function detachPageHooks(ctx) {
  for (const fn of ctx._hooks.splice(0)) ctx.doc.removeListener('pageAdded', fn);
}

/**
 * Flush buffered pages, end the document and return the PDF bytes.
 * @param {PdfContext} ctx
 * @returns {Promise<Buffer>}
 */
export function finalizePdf(ctx) {
  const { doc } = ctx;
  detachPageHooks(ctx);
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(ctx._chunks)));
    doc.on('error', reject);
    doc.flushPages();
    doc.end();
  });
}
