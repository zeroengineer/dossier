// One-page sample of a brand's letterhead, palette, fonts, signature block and footer, for the settings preview.
// Every printed brand string comes from the brand; the few sample labels are generic.
import { attachLetterhead, createPdf, drawFooters, drawSignatureBlock, finalizePdf } from './pdf/index.js';

const WEIGHTS = [['Regular', 'regular'], ['Medium', 'medium'], ['SemiBold', 'semibold'], ['Bold', 'bold'], ['ExtraBold', 'extrabold']];

/**
 * Render the preview PDF of a brand as currently loaded in `ws`.
 * @param {object} ws loaded workspace
 * @param {string} brandId
 * @param {{ creationDate?: Date }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function renderBrandPreview(ws, brandId, { creationDate = new Date() } = {}) {
  const brand = ws.brands.get(brandId);
  if (!brand) throw new Error(`renderBrandPreview: unknown brand "${brandId}"`);
  const ctx = await createPdf({ profileId: 'letter', brand, ws, info: { title: `${brand.legalName}: letterhead preview`, creationDate } });
  const { doc, profile, palette } = ctx;
  await attachLetterhead(ctx);
  doc.addPage();
  const x = profile.ML;
  const width = profile.CW;

  doc.font('Bold').fontSize(14).fillColor(palette.ink).text('Letterhead preview', x, doc.y, { width });
  doc.moveDown(0.4);
  doc.font('Regular').fontSize(10).fillColor(palette.body)
    .text(`${brand.legalName} (${brand.shortName}), brand "${brand.id}". This page shows the letterhead, the footer and a signature block as documents print them.`, x, doc.y, { width });

  doc.moveDown(1.2);
  doc.font('SemiBold').fontSize(9).fillColor(palette.section).text('PALETTE', x, doc.y);
  doc.moveDown(0.4);
  const keys = Object.keys(palette).filter((k) => typeof palette[k] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(palette[k]));
  const sw = 14;
  const cols = 4;
  const colW = width / cols;
  const top = doc.y;
  keys.forEach((k, i) => {
    const cx = x + (i % cols) * colW;
    const cy = top + Math.floor(i / cols) * (sw + 6);
    doc.rect(cx, cy, sw, sw).fillColor(palette[k]).fill();
    doc.rect(cx, cy, sw, sw).lineWidth(0.3).strokeColor(palette.ruleStrong).stroke();
    doc.font('Regular').fontSize(8).fillColor(palette.label).text(`${k} ${palette[k]}`, cx + sw + 5, cy + 3, { width: colW - sw - 8, lineBreak: false });
  });
  doc.y = top + Math.ceil(keys.length / cols) * (sw + 6) + 8;

  doc.font('SemiBold').fontSize(9).fillColor(palette.section).text('FONTS', x, doc.y);
  doc.moveDown(0.4);
  for (const [name, weight] of WEIGHTS) {
    doc.font(name).fontSize(10).fillColor(palette.body).text(`${weight}: ${brand.shortName} 0123456789`, x, doc.y, { width });
  }

  doc.moveDown(1.5);
  const signatory = brand.signatories.find((s) => s.id === brand.defaultSignatory.letter) ?? brand.signatories[0];
  if (signatory) {
    await drawSignatureBlock(ctx, { y: doc.y, signatoryId: signatory.id });
  } else {
    doc.font('Regular').fontSize(10).fillColor(palette.muted).text('No signatories are configured for this brand.', x, doc.y, { width });
  }
  drawFooters(ctx);
  return finalizePdf(ctx);
}
