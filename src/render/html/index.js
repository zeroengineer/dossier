// HTML rendition of a block document: one A4-wide page in pt with the brand fonts, letterhead and footer. A "web
// rendition" that mirrors the PDF metrics (same fonts, sizes, colours, spacing), not a line-for-line facsimile.
import { existsSync, readFileSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';
import { brandAsset, interpolate } from '../../workspace/index.js';
import { FONTS_DIR } from '../../paths.js';
import { brandScope } from '../pdf/document.js';
import { getProfile } from '../pdf/profiles.js';
import { inlineRuns, normaliseTable, paletteColour, resolveBlockStyle, validateBlocks } from '../blocks.js';

/** pdfkit line height of the bundled fonts as a multiple of the font size (Manrope: (ascender - descender) / em). */
export const LINE_HEIGHT_RATIO = 1.366;

const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 };
const MIME = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

/**
 * Escape text for HTML element content and attribute values.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** CSS font weight of a pdfkit font name (`BodyBold`, `SemiBold`, `ExtraBold`, `Regular`…). */
export function fontWeight(name = 'Regular') {
  const n = String(name).replace(/^Body/, '').toLowerCase();
  return { extrabold: 800, bold: 700, semibold: 600, medium: 500, regular: 400, light: 300, extralight: 200 }[n] ?? 400;
}

/** Hex, rgb()/rgba()/hsl()/hsla() or a CSS colour keyword; anything else is not put into the stylesheet. */
const CSS_COLOUR = /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/+-]+\)|[a-zA-Z]+)$/;

/**
 * A value safe to place in the stylesheet as a colour: valid CSS colours pass, anything else becomes `inherit`.
 * @param {unknown} v
 * @returns {string}
 */
export function cssColour(v) {
  return typeof v === 'string' && CSS_COLOUR.test(v.trim()) ? v.trim() : 'inherit';
}

/** A styleVars value: no characters that could end the declaration, rule or style element, open a string or a comment. */
const cssValue = (v) => String(v ?? '').replace(/\/\*|\*\//g, '').replace(/[<>{};\\"']/g, '');

/** A length in points for CSS (rounded to 0.001). */
export const pt = (n) => `${Math.round(n * 1000) / 1000}pt`;
/** Inline `**bold**` to `<strong>`, newlines to `<br>`, everything escaped. */
const inline = (text) => inlineRuns(text).map((r) => {
  const t = escapeHtml(r.text).replace(/\n/g, '<br>');
  return r.bold ? `<strong>${t}</strong>` : t;
}).join('');

const dataUri = (file) => `data:${MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;

/** URL of a font: embedded, under `<assetBase>/fonts/` for bundled fonts, else `<assetBase>/brands/<id>/fonts/<file>`. */
function fontUrl(file, { standalone, assetBase, brand }) {
  if (standalone) return dataUri(file);
  const rel = relative(FONTS_DIR, file);
  if (!rel.startsWith('..')) return `${assetBase}/fonts/${rel.split(sep).map(encodeURIComponent).join('/')}`;
  return `${assetBase}/brands/${encodeURIComponent(brand.id)}/fonts/${encodeURIComponent(file.split(sep).at(-1))}`;
}

/**
 * URL of a brand image (`assets.logo`, `signature:<id>`, `signature-large:<id>`): a data URI with `standalone: true`,
 * else the URLs the HTTP server serves, `<assetBase>/brands/<id>/logo` and `<assetBase>/brands/<id>/signatures/<signatoryId>`.
 * Null when there is no workspace or no file.
 * @param {object|undefined} ws @param {object} brand @param {string} key
 * @param {{ standalone?: boolean, assetBase?: string }} opts
 * @returns {string|null}
 */
export function imageUrl(ws, brand, key, { standalone, assetBase = '/assets' }) {
  if (!ws) return null;
  const file = brandAsset(ws, brand.id, key);
  if (!file || !existsSync(file)) return null;
  if (standalone) return dataUri(file);
  const [kind, arg] = key.split(':');
  if (kind === 'assets.logo') return `${assetBase}/brands/${encodeURIComponent(brand.id)}/logo`;
  return `${assetBase}/brands/${encodeURIComponent(brand.id)}/signatures/${encodeURIComponent(arg)}`;
}

/**
 * `@font-face` rules for the brand fonts (family `DossierBody`, weights 400-800): embedded with `standalone: true`,
 * else URLs under `assetBase`.
 * @param {object|undefined} ws @param {object} brand @param {{ standalone?: boolean, assetBase?: string }} opts
 * @returns {string}
 */
export function fontFaces(ws, brand, opts) {
  return Object.entries(WEIGHTS).map(([w, weight]) => {
    const file = ws ? brandAsset(ws, brand.id, `font:${w}`) : `${FONTS_DIR}${sep}Manrope${sep}Manrope-${w === 'semibold' ? 'SemiBold' : w === 'extrabold' ? 'ExtraBold' : w[0].toUpperCase() + w.slice(1)}.ttf`;
    return `@font-face { font-family: 'DossierBody'; font-weight: ${weight}; font-style: normal; src: url("${fontUrl(file, { ...opts, brand })}"); }`;
  }).join('\n');
}

function css(s, profile, palette, styleVars) {
  const lh = (size, gap = 0) => pt(size * LINE_HEIGHT_RATIO + gap);
  const lines = (n, size) => pt(n * size * LINE_HEIGHT_RATIO);
  const c = (v) => cssColour(paletteColour(palette, v));
  const name = (k) => `--${String(k).replace(/^--/, '').replace(/[^A-Za-z0-9_-]/g, '')}`;
  const vars = Object.fromEntries(Object.entries(palette).map(([k, v]) => [name(k), cssColour(v)]));
  for (const [k, v] of Object.entries(styleVars ?? {})) vars[name(k)] = cssValue(v);
  const p = s.paragraph;
  const heading = (lvl) => {
    const h = s.heading[lvl];
    return `.doc h${lvl} { font-size: ${pt(h.size)}; font-weight: ${fontWeight(h.font)}; line-height: ${lh(h.size, h.lineGap)}; color: ${c(h.color)};`
      + ` margin: ${lines(h.before, h.size)} 0 ${lines(h.after, h.size)};${h.uppercase ? ' text-transform: uppercase;' : ''}${h.align ? ` text-align: ${cssValue(h.align)};` : ''} break-after: avoid; }`;
  };
  const list = (l, tag) => `.doc ${tag} { margin: 0 0 ${lines(l.moveDown, p.fontSize)}; padding-left: ${pt(l.bulletX + l.indent)}; }\n`
    + `.doc ${tag} li { margin: 0 0 ${lines(l.itemMoveDown, p.fontSize)}; padding-left: 0; }`;
  const t = s.table;
  const kv = s.keyValue;
  const sig = s.signature;
  const d = s.divider;
  return `@page { size: A4; margin: 0; }
:root { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')} }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { font-family: 'DossierBody', sans-serif; color: ${c(p.color)}; font-size: ${pt(p.fontSize)}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${pt(profile.PW)}; min-height: ${pt(profile.PH)}; margin: 0 auto; padding: ${pt(profile.MT + (profile.CP ?? 0))} ${pt(profile.MR)} ${pt(profile.MB)} ${pt(profile.ML)}; background: #ffffff; }
.letterhead { position: absolute; top: 0; left: ${pt(profile.ML)}; right: ${pt(profile.MR)}; height: ${pt(profile.MT - 15)}; display: flex; align-items: center; justify-content: space-between; border-bottom: 0.3pt solid ${c('rule')}; }
.letterhead img { height: ${pt(profile.LOGO_H ?? 32)}; width: auto; }
.letterhead .lh-text { text-align: right; font-size: 8pt; line-height: ${lh(8, 0.5)}; color: ${c('label')}; }
.letterhead .lh-name { font-size: 8.5pt; font-weight: 700; color: ${c('ink')}; }
.doc h1, .doc h2, .doc h3, .doc p { font-family: inherit; }
${heading(1)}
${heading(2)}
${heading(3)}
.doc p { font-size: ${pt(p.fontSize)}; line-height: ${lh(p.fontSize, p.lineGap)}; text-align: ${cssValue(p.align)}; margin: 0 0 ${lines(p.moveDown, p.fontSize)}; color: ${c(p.color)}; }
.doc strong { font-weight: ${fontWeight(p.boldFont)}; }
.doc .cover { text-align: center; }
${list(s.bullets, 'ul')}
.doc ul { list-style: none; }
.doc ul li { position: relative; }
.doc ul li::before { content: ${JSON.stringify(String(s.bullets.bullet)).replace(/</g, '\\3c ')}; position: absolute; left: ${pt(-s.bullets.indent)}; }
${list(s.numbered, 'ol')}
.doc li { font-size: ${pt(p.fontSize)}; line-height: ${lh(p.fontSize, p.lineGap)}; text-align: ${cssValue(p.align)}; }
.doc table.data { width: 100%; border-collapse: collapse; margin: ${lines(t.before, p.fontSize)} 0 ${lines(t.after, t.row.size)}; break-inside: auto; }
.doc table.data th { background: ${c(t.header.fill)}; color: ${c(t.header.color)}; font-size: ${pt(t.header.size)}; font-weight: ${fontWeight(t.header.font)}; height: ${pt(t.header.height)}; padding: ${pt(t.header.padY)} ${pt(t.row.padX)}; text-align: left; }
.doc table.data td { font-size: ${pt(t.row.size)}; font-weight: ${fontWeight(t.row.font)}; color: ${c(t.row.color)}; height: ${pt(t.row.height === 'auto' ? t.row.minHeight ?? 0 : t.row.height)}; padding: ${pt(t.row.padY)} ${pt(t.row.padX)}; vertical-align: top; }
${(t.row.fills ?? []).map((f, i, all) => `.doc table.data tbody tr:nth-child(${all.length}n+${i + 1}) { background: ${c(f)}; }`).join('\n')}
.doc table.data tr.total td { background: ${c(t.total.fill)}; color: ${c(t.total.color)}; font-weight: ${fontWeight(t.total.font)}; }
.doc .left { text-align: left !important; }
.doc .right { text-align: right !important; }
.doc .center { text-align: center !important; }
.doc table.kv { border-collapse: collapse; margin: ${lines(kv.before, kv.size)} 0 ${lines(kv.after, kv.size)} ${pt(kv.indent)}; font-size: ${pt(kv.size)}; }
.doc table.kv td { padding: 0; height: ${pt(kv.rowHeight)}; vertical-align: top; }
.doc table.kv td.k { width: ${pt(kv.labelWidth)}; font-weight: ${fontWeight(kv.labelFont)}; color: ${c(kv.labelColor)}; }
.doc table.kv td.v { font-weight: ${fontWeight(kv.valueFont)}; color: ${c(kv.valueColor)}; }
.doc .signature { margin: ${pt(sig.gap)} 0 ${lines(sig.after, sig.lineSize)}; break-inside: avoid; }
.doc .signature .for { font-size: ${pt(sig.partySize)}; font-weight: ${fontWeight(sig.partyFont)}; color: ${c('ink')}; }
.doc .signature img { display: block; height: 55pt; width: auto; margin: 10pt 0 8pt; }
.doc .signature .sign-line { width: ${pt(sig.signLineWidth)}; height: ${pt(sig.signLineGap)}; border-bottom: 0.5pt solid ${c(sig.signLineColor)}; margin-bottom: 6pt; }
.doc .signature .name { font-size: 10pt; font-weight: 700; color: ${c('ink')}; }
.doc .signature .title, .doc .signature .line { font-size: ${pt(sig.lineSize)}; color: ${c(sig.lineColor)}; }
.doc .signature .title { font-weight: 500; }
.doc hr.divider { border: 0; border-top: ${pt(d.lineWidth)} solid ${c(d.color)}; margin: ${lines(d.before, p.fontSize)} 0 ${lines(d.after, p.fontSize)}; }
.doc .page-break { break-after: page; height: 0; }
.footer { display: flex; justify-content: space-between; gap: 12pt; margin-top: 24pt; padding-top: 7pt; border-top: 0.5pt solid ${c('ruleStrong')}; font-size: 7.5pt; color: ${c('muted')}; }
.footer .center { color: ${c('subtle')}; }
@media print { .page { margin: 0; } }`;
}

function signatureHtml(b, brand, ws, opts) {
  const lines = (b.lines ?? []).map((l) => `<div class="line">${escapeHtml(l)}</div>`).join('');
  const party = b.party ?? (b.signatoryId ? interpolate(brand.strings?.forCompany ?? '', brandScope(brand, opts.contact)) : '');
  const forLine = party ? `<div class="for">${escapeHtml(party)}</div>` : '';
  if (!b.signatoryId) return `<div class="signature">${forLine}<div class="sign-line"></div>${lines}</div>`;
  const s = brand.signatories.find((x) => x.id === b.signatoryId);
  if (!s) throw new Error(`blocksToHtml: brand "${brand.id}" has no signatory "${b.signatoryId}"`);
  const src = imageUrl(ws, brand, `signature-large:${s.id}`, opts);
  const img = src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(`Signature of ${s.name}`)}">` : '<div class="sign-line"></div>';
  return `<div class="signature">${forLine}${img}<div class="name">${escapeHtml(s.name)}</div>`
    + `${s.title ? `<div class="title">${escapeHtml(s.title)}</div>` : ''}${lines}</div>`;
}

function blockHtml(b, ctx) {
  const cover = b.cover ? ' class="cover"' : '';
  const align = (base) => {
    const cls = [base, b.cover ? 'cover' : '', b.align && b.align !== 'justify' ? b.align : ''].filter(Boolean).join(' ');
    const style = b.align === 'justify' ? ' style="text-align: justify"' : '';
    return `${cls ? ` class="${cls}"` : ''}${style}`;
  };
  switch (b.type) {
    case 'heading': return `<h${b.level}${align('')}>${inline(b.text)}</h${b.level}>`;
    case 'paragraph': return `<p${align('')}>${inline(b.text)}</p>`;
    case 'bullets': return `<ul${cover}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
    case 'numbered': return `<ol${cover}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
    case 'table': {
      const t = normaliseTable(b);
      const cls = (c) => (c.align === 'right' || c.align === 'center' ? ` class="${c.align}"` : '');
      const width = (c) => (c.width ? ` style="width: ${pt(c.width)}"` : '');
      const head = b.header === false ? '' : `<thead><tr>${t.columns.map((c) => `<th${cls(c)}${width(c)}>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
      const row = (r, total) => `<tr${total ? ' class="total"' : ''}>${t.columns.map((c) => `<td${cls(c)}>${inline(r[c.key])}</td>`).join('')}</tr>`;
      return `<table class="data">${head}<tbody>${t.rows.map((r) => row(r, false)).join('')}${t.totalRows.map((r) => row(r, true)).join('')}</tbody></table>`;
    }
    case 'keyValue':
      return `<table class="kv"><tbody>${b.rows.map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(`${ctx.s.keyValue.separator}${v ?? ''}`)}</td></tr>`).join('')}</tbody></table>`;
    case 'signature': return signatureHtml(b, ctx.brand, ctx.ws, ctx.opts);
    case 'spacer': return `<div class="spacer" style="height: ${b.lines !== undefined ? `${b.lines}em` : pt(b.size)}"></div>`;
    case 'divider': return '<hr class="divider">';
    case 'pageBreak': return '<div class="page-break"></div>';
    case 'custom':
      if (typeof b.data?.html === 'string') return b.data.html;
      return b.data?.text !== undefined ? `<p>${inline(b.data.text)}</p>` : '';
    default: return '';
  }
}

/**
 * Render blocks to a complete HTML document (inline CSS in pt mirroring the PDF metrics; A4 `@page` with no margin;
 * `.page` padded by the layout profile margins). All interpolated text is escaped; `custom` blocks insert their
 * `data.html` as given (templates must escape what they put there) or else `data.text`.
 * @param {Array<object>} blocks
 * @param {{ brand: object, ws?: object, title?: string, styleVars?: Record<string, string>, style?: object,
 *   standalone?: boolean, profileId?: string, contact?: string, letterhead?: boolean, footer?: boolean,
 *   assetBase?: string }} opts
 *   `ws` (loaded workspace) locates fonts, logo and signatures; `standalone: true` embeds fonts (base64) and images
 *   (data URIs) so the file works offline (vault renditions); otherwise fonts load from `<assetBase>/fonts/…` and
 *   images from `<assetBase>/brands/<id>/…`. `styleVars` overrides CSS custom properties (`ink` or `--ink`).
 *   `style` is the same block style as renderBlocksPdf.
 * @returns {string}
 */
export function blocksToHtml(blocks, opts) {
  const { brand, ws, title, styleVars = {}, style, standalone = false, profileId = 'letter', contact = 'default',
    letterhead = true, footer = true, assetBase = '/assets' } = opts ?? {};
  if (!brand) throw new Error('blocksToHtml: brand is required');
  validateBlocks(blocks);
  const s = resolveBlockStyle(style);
  const profile = getProfile(profileId, brand.layoutProfiles);
  const palette = brand.palette ?? {};
  const scope = brandScope(brand, contact);
  const urlOpts = { standalone, assetBase, contact };

  let head = '';
  if (letterhead) {
    const logo = imageUrl(ws, brand, 'assets.logo', urlOpts);
    const lines = (brand.letterhead?.lines ?? []).map((l) => `<div>${escapeHtml(interpolate(l, scope))}</div>`).join('');
    head = `<header class="letterhead">${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(brand.shortName ?? brand.legalName)}">` : '<span></span>'}`
      + `<div class="lh-text"><div class="lh-name">${escapeHtml(brand.legalName)}</div>${lines}</div></header>`;
  }
  let foot = '';
  if (footer) {
    const slot = (k) => {
      const raw = brand.footer?.[k] ?? '';
      return /\{pages?\}/.test(raw) ? '' : interpolate(raw, scope);
    };
    const [l, c, r] = ['left', 'center', 'right'].map(slot);
    if (l || c || r) foot = `<footer class="footer"><span class="left">${escapeHtml(l)}</span><span class="center">${escapeHtml(c)}</span><span class="right">${escapeHtml(r)}</span></footer>`;
  }
  const ctx = { s, brand, ws, opts: urlOpts };
  const body = blocks.map((b) => blockHtml(b, ctx)).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title ?? brand.legalName)}</title>
<style>
${fontFaces(ws, brand, urlOpts)}
${css(s, profile, palette, styleVars)}
</style>
</head>
<body>
<div class="page">
${head}
<main class="doc">
${body}
</main>
${foot}
</div>
</body>
</html>
`;
}
