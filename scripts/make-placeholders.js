#!/usr/bin/env node
// Generates the neutral placeholder images in assets/placeholders/ (logo, signatures, seal).
// Deterministic: drawings are pure SVG paths (no system fonts), rendered by sharp with fixed PNG options.
// Usage: node scripts/make-placeholders.js [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const GREY = '#8a8a8a';
const LIGHT = '#b8b8b8';

// Stroke glyphs in a 100 x 140 box (no fonts involved, so output is identical on every machine).
const GLYPHS = {
  L: 'M0,0 V140 H100',
  O: 'M50,0 A50,70 0 1 0 50.01,0 Z',
  G: 'M93.3,35 A50,70 0 1 0 93.3,105 V75 H55',
  S: 'M95,25 C80,-5 5,-5 5,35 C5,72 95,62 95,103 C95,145 15,148 3,112',
  E: 'M100,0 H0 V140 H100 M0,70 H80',
  A: 'M0,140 L50,0 L100,140 M18,90 H82',
};

/** SVG group drawing `word` with its box top-left at (x, y), glyph height h. */
function word(text, x, y, h, stroke) {
  const s = h / 140;
  const advance = 100 + 45;
  return text.split('').map((ch, i) => `<path transform="translate(${x + i * advance * s},${y}) scale(${s})" d="${GLYPHS[ch]}" fill="none" stroke="${GREY}" stroke-width="${stroke / s}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}
const wordWidth = (text, h) => (text.length * 145 - 45) * (h / 140);

function logoSvg(w, h) {
  const gh = 130; const gw = wordWidth('LOGO', gh);
  return `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="24" fill="none" stroke="${LIGHT}" stroke-width="8" stroke-dasharray="28 18"/>`
    + word('LOGO', (w - gw) / 2, (h - gh) / 2, gh, 18);
}

// One scribble drawn in a 1024 x 406 viewBox; scaled for both signature sizes.
function signatureSvg() {
  const d = 'M70,260 C120,120 170,90 190,150 C210,215 150,300 175,305 C215,312 250,150 300,140 '
    + 'C340,132 300,280 345,270 C385,262 395,170 430,175 C470,180 420,270 465,265 C520,258 540,120 590,130 '
    + 'C640,140 560,300 620,290 C680,280 700,180 740,190 C780,200 735,275 780,270 C840,262 880,200 950,215';
  return `<path d="${d}" fill="none" stroke="${GREY}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M110,330 C330,312 620,318 900,300" fill="none" stroke="${GREY}" stroke-width="5" stroke-linecap="round"/>`;
}

function sealSvg(w, h) {
  const cx = w / 2; const cy = h / 2; const r = Math.min(w, h) / 2 - 20;
  const dots = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * 2 * Math.PI; const rr = r - 70;
    return `<circle cx="${(cx + rr * Math.cos(a)).toFixed(2)}" cy="${(cy + rr * Math.sin(a)).toFixed(2)}" r="9" fill="${LIGHT}"/>`;
  }).join('');
  const gh = 220; const gw = wordWidth('SEAL', gh);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${GREY}" stroke-width="24"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r - 130}" fill="none" stroke="${GREY}" stroke-width="10"/>`
    + dots + word('SEAL', cx - gw / 2, cy - gh / 2, gh, 30);
}

/** Every placeholder: file name, pixel size and SVG body (in a viewBox of `vb` or the pixel size). */
export const PLACEHOLDERS = [
  { file: 'logo.png', width: 1027, height: 234, body: () => logoSvg(1027, 234) },
  { file: 'signature.png', width: 1024, height: 406, body: signatureSvg, viewBox: '0 0 1024 406' },
  { file: 'signature-large.png', width: 5914, height: 4873, body: signatureSvg, scale: true },
  { file: 'seal.png', width: 1586, height: 1471, body: () => sealSvg(1586, 1471) },
];

/**
 * Render one placeholder to PNG bytes.
 * @param {{ file: string, width: number, height: number, body: () => string, viewBox?: string }} p
 * @returns {Promise<Buffer>}
 */
export async function renderPlaceholder(p) {
  let viewBox = p.viewBox ?? `0 0 ${p.width} ${p.height}`;
  if (p.scale) {
    // keep the signature's aspect: fit the 1024-wide drawing across the canvas, centred vertically
    const vbH = (1024 * p.height) / p.width;
    viewBox = `0 ${((406 - vbH) / 2).toFixed(3)} 1024 ${vbH.toFixed(3)}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="${viewBox}" preserveAspectRatio="none">${p.body()}</svg>`;
  return sharp(Buffer.from(svg), { density: 72 })
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 16, dither: 0 })
    .toBuffer();
}

/** Write every placeholder into `outDir`. @param {string} outDir */
export async function makePlaceholders(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const p of PLACEHOLDERS) writeFileSync(join(outDir, p.file), await renderPlaceholder(p));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sharp.cache(false);
  const out = resolve(process.argv[2] ?? fileURLToPath(new URL('../assets/placeholders', import.meta.url)));
  await makePlaceholders(out);
  console.log(`placeholders written to ${out}`);
}
