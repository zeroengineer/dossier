// Signature block (legacy offer letter / certificates / remittance / invoice signatory; docs/DISCOVERY.md A8 §1, §2, §4).
import { placeImage } from './images.js';

/** Offer-letter defaults: image h55 at +24, name +22 below the image, title +14, seal w76 rotated -6° at 0.85. */
export const SIGNATURE_DEFAULTS = Object.freeze({
  imageHeight: 55,
  offsets: { image: 24, name: 22, title: 14 },
  forStyle: { font: 'BodyBold', size: 9.5 },
  nameStyle: { font: 'BodyBold', size: 10 },
  titleStyle: { font: 'BodyMedium', size: 9 },
  seal: { width: 76, rotate: -6, opacity: 0.85, dx: 8, dy: -8 },
});

/**
 * Draw "For <company>", the signatory's signature image, an optional company seal, the name, title and extra lines.
 * The image is sized from its real aspect ratio. With `align: 'right'` the block is right-aligned inside
 * `[x, x + width]` (invoice style: texts right-aligned, image flush right).
 *
 * Layout (y down): forLine at `y`; image at `y + offsets.image`, height `imageHeight`; name at
 * `imageY + imageHeight + offsets.name`; title at `nameY + offsets.title`; each extra line at `nameY + line.dy`.
 * Seal (when not null): width `seal.width`, at `x = PW - MR - seal.width - seal.dx` (or `seal.x`), `y = imageY + seal.dy`,
 * rotated `seal.rotate` degrees about its centre, opacity `seal.opacity`.
 * @param {import('./document.js').PdfContext} ctx
 * @param {{ x?: number, y: number, align?: 'left'|'right', width?: number, forLine?: string, signatoryId: string,
 *   variant?: 'large'|'compact', imageOptions?: { trim?: boolean, resizeWidth?: number, resizeHeight?: number, flattenWhite?: boolean },
 *   imageHeight?: number, offsets?: { image?: number, name?: number, title?: number },
 *   seal?: null|{ width?: number, rotate?: number, opacity?: number, dx?: number, dy?: number, x?: number },
 *   forStyle?: object, nameStyle?: object, titleStyle?: object,
 *   name?: string, title?: string,
 *   extraLines?: Array<{ text: string, dy: number, font?: string, size?: number, color?: string }> }} opts
 *   Styles are `{ font, size, color }`; colours default to ink (for, name) and muted (title, extra lines).
 *   `imageOptions` change how the signature image is prepared (default: flattened on white; the remittance letter
 *   trims it and resizes it to width 500 first).
 * @returns {Promise<{ imageY: number, nameY: number, bottom: number }>}
 */
export async function drawSignatureBlock(ctx, opts) {
  const { doc, profile, brand, palette } = ctx;
  const d = SIGNATURE_DEFAULTS;
  const signatory = brand.signatories.find((s) => s.id === opts.signatoryId);
  if (!signatory) throw new Error(`drawSignatureBlock: brand "${brand.id}" has no signatory "${opts.signatoryId}"`);
  const x = opts.x ?? profile.ML;
  const { y } = opts;
  const align = opts.align ?? 'left';
  const width = opts.width ?? 200;
  const imageHeight = opts.imageHeight ?? d.imageHeight;
  const offsets = { ...d.offsets, ...opts.offsets };
  const forStyle = { color: palette.ink, ...d.forStyle, ...opts.forStyle };
  const nameStyle = { color: palette.ink, ...d.nameStyle, ...opts.nameStyle };
  const titleStyle = { color: palette.muted, ...d.titleStyle, ...opts.titleStyle };
  const textOpts = align === 'right' ? { align: 'right', width } : {};

  const sig = await ctx.assets.signature(signatory.id, { variant: opts.variant ?? 'large', ...opts.imageOptions });
  const seal = opts.seal === null ? null : opts.seal === undefined ? d.seal : { ...d.seal, ...opts.seal };
  const sealImg = seal ? await ctx.assets.seal() : null;

  const forLine = opts.forLine ?? ctx.t('forCompany');
  if (forLine) {
    doc.font(forStyle.font).fontSize(forStyle.size).fillColor(forStyle.color).text(forLine, x, y, textOpts);
  }

  const imageY = y + offsets.image;
  const imageW = sig.width * (imageHeight / sig.height);
  const imageX = align === 'right' ? x + width - imageW : x;
  placeImage(ctx, sig, imageX, imageY, { height: imageHeight });

  if (seal) {
    const sealH = seal.width * (sealImg.height / sealImg.width);
    const sealX = seal.x ?? profile.PW - profile.MR - seal.width - seal.dx;
    const sealY = imageY + seal.dy;
    doc.save();
    doc.opacity(seal.opacity);
    doc.rotate(seal.rotate, { origin: [sealX + seal.width / 2, sealY + sealH / 2] });
    placeImage(ctx, sealImg, sealX, sealY, { width: seal.width });
    doc.restore();
  }

  const nameY = imageY + imageHeight + offsets.name;
  doc.font(nameStyle.font).fontSize(nameStyle.size).fillColor(nameStyle.color)
    .text(opts.name ?? signatory.name, x, nameY, textOpts);
  let bottom = doc.y;
  const title = opts.title ?? signatory.title;
  if (title) {
    doc.font(titleStyle.font).fontSize(titleStyle.size).fillColor(titleStyle.color)
      .text(title, x, nameY + offsets.title, textOpts);
    bottom = doc.y;
  }
  for (const line of opts.extraLines ?? []) {
    doc.font(line.font ?? 'Regular').fontSize(line.size ?? titleStyle.size).fillColor(line.color ?? palette.muted)
      .text(line.text, x, nameY + line.dy, textOpts);
    bottom = doc.y;
  }
  return { imageY, nameY, bottom };
}
