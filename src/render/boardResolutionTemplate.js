// Module code of the board resolution (src/templates/board-resolution), ported from the legacy board resolution
// script (docs/DISCOVERY.md A8 §11): letterhead, letter-spaced title, date, bold preamble, underlined "RESOLVED:",
// resolution paragraphs with director lists (name and a signature rule), the certification block in three columns
// (two directors and the company seal) and a footer with only the centre text. Every printed string comes from the
// template params (neutral defaults in template.json), the brand or the values; the layout is BOARD_RESOLUTION_FRAME,
// which `params.frame` deep-merges over.
import { interpolate } from '../workspace/index.js';
import { mergeStyle, paletteColour } from './blocks.js';
import { attachLetterhead } from './pdf/letterhead.js';
import { drawFooters } from './pdf/footer.js';
import { needsBreak } from './pdf/text.js';
import { referenceNumber, textLines } from './letterTemplate.js';

/** Legacy layout (board resolution script). Colours are palette keys or hex. */
export const BOARD_RESOLUTION_FRAME = Object.freeze({
  title: { font: 'ExtraBold', size: 15, color: 'ink', characterSpacing: 1, after: 0.3 },
  date: { font: 'SemiBold', size: 9.5, color: 'ink', after: 1.3 },
  preamble: { font: 'Bold', size: 9.5, color: 'ink', lineGap: 5, after: 1.6 },
  resolved: { font: 'ExtraBold', size: 10.5, color: 'ink', underline: true, after: 1 },
  paragraph: { font: 'Regular', size: 9.5, color: 'body', lineGap: 5, after: 1.1 },
  directors: {
    startDy: -22, rowH: 40, textDy: -14, bulletX: 12, bulletW: 10, bullet: '•', nameX: 26, nameW: 165,
    nameFont: 'SemiBold', nameColor: 'ink', lineX: 340, lineDy: 11, lineColor: '#9a9a9a', lineWidth: 0.5, after: 18,
  },
  certification: {
    height: 125, before: 0.4, title: { font: 'Bold', size: 9.5, color: 'ink' }, forDy: 15, forLine: { font: 'Regular', size: 9.5, color: 'label' },
    signGap: 84, colGap: 24, minColumns: 3, nameDy: 7, name: { font: 'SemiBold', size: 9.5, color: 'ink' }, subDy: 21, sub: { font: 'Regular', size: 8.5, color: 'muted' },
  },
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v) => !(v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));

/**
 * The directors list: `[{ name, role? }]` (a plain name string counts as `{ name }`).
 * @param {unknown} v
 * @returns {Array<{ name: string, role: string }>}
 */
export function directorList(v) {
  if (!Array.isArray(v) || v.length === 0) throw new Error('directors must be a non-empty list of { name, role }');
  return v.map((d, i) => {
    const o = typeof d === 'string' ? { name: d } : d;
    if (!isPlainObject(o) || !present(o.name)) throw new Error(`directors.${i} must be { name, role }`);
    return { name: String(o.name).trim(), role: present(o.role) ? String(o.role).trim() : '' };
  });
}

/**
 * The directors who sign the certification: `certifiers` (director names) or the first two directors.
 * @param {Record<string, any>} values
 */
function certifierList(values) {
  const directors = directorList(values.directors);
  if (!present(values.certifiers)) return directors.slice(0, 2);
  if (!Array.isArray(values.certifiers)) throw new Error('certifiers must be a list of director names');
  return values.certifiers.map((n, i) => {
    const d = directors.find((x) => x.name.toLowerCase() === String(n ?? '').trim().toLowerCase());
    if (!d) throw new Error(`certifiers.${i}: "${n}" is not one of the directors`);
    return d;
  });
}

export const computed = Object.freeze({
  directorList: (values) => directorList(values.directors),
  certifierList,
});

/**
 * Everything printed, as strings: title, ref and date lines, preamble, resolutions (`{ text, directors }`), the
 * certification block. Text params are interpolated with the brand plus `{company}`, `{companyUpper}`, `{address}`,
 * `{addressUpper}`, `{date}` (`params.dateStyle`, default `short`), `{bank}` and `{number}`.
 * @param {Record<string, any>} values @param {{ brand: object, params: object, fmt: object, meta: object }} env
 */
export function boardResolutionModel(values, env) {
  const p = env.params ?? {};
  const { brand, fmt } = env;
  const address = textLines(values.address ?? brand.addresses?.registered ?? brand.addresses?.business).join(', ');
  const ref = referenceNumber(values, env);
  const scope = {
    ...brand,
    company: brand.legalName,
    companyUpper: String(brand.legalName).toUpperCase(),
    address,
    addressUpper: address.toUpperCase(),
    date: values.date ? fmt.date(values.date, p.dateStyle ?? 'short') : '',
    bank: String(values.bank ?? ''),
    number: ref,
  };
  const fill = (t) => interpolate(String(t ?? ''), scope).trim();
  const directors = values.directorList ?? directorList(values.directors);
  const items = values.resolutions ?? p.resolutions ?? [];
  if (!Array.isArray(items)) throw new Error('resolutions must be a list');
  const resolutions = items.map((r) => (typeof r === 'string' ? { text: r } : r)).map((r) => ({
    text: fill(r.text), directors: r.directors === true ? directors : null,
  }));
  const cert = p.certification ?? {};
  return {
    title: fill(p.title),
    ref: ref ? fill(p.refLabel ?? 'Ref: {number}') : '',
    date: fill(p.dateLabel ?? 'Date: {date}'),
    preamble: fill(p.preamble),
    resolved: fill(p.resolvedLabel),
    resolutions,
    certification: {
      title: fill(cert.title),
      forLine: fill(cert.forLine),
      signers: (values.certifierList ?? certifierList(values)).map((d) => ({ title: d.name, sub: d.role })),
      seal: cert.sealTitle ? { title: fill(cert.sealTitle), sub: fill(cert.sealSub) } : null,
    },
  };
}

const col = (ctx, c) => paletteColour(ctx.palette, c);
const font = (ctx, s) => ctx.doc.font(s.font).fontSize(s.size).fillColor(col(ctx, s.color));

/**
 * Draw the board resolution (renderPdf contract).
 * @param {import('./pdf/document.js').PdfContext} ctx @param {ReturnType<typeof boardResolutionModel>} m
 * @param {{ contact?: string, frame?: object, footer?: object }} [opts]
 */
export async function drawBoardResolution(ctx, m, opts = {}) {
  const f = mergeStyle(BOARD_RESOLUTION_FRAME, opts.frame ?? {});
  const { doc, profile } = ctx;
  const { ML, MR, MT, PW, CW } = profile;
  await attachLetterhead(ctx, { contact: opts.contact });
  doc.addPage();

  font(ctx, f.title).text(m.title, ML, MT, { width: CW, align: 'center', characterSpacing: f.title.characterSpacing });
  doc.moveDown(f.title.after);

  const dateY = doc.y;
  if (m.ref) font(ctx, f.date).text(m.ref, ML, dateY, { lineBreak: false });
  font(ctx, f.date).text(m.date, ML, dateY, { width: CW, align: 'right' });
  doc.moveDown(f.date.after);

  if (m.preamble) {
    font(ctx, f.preamble).text(m.preamble, ML, doc.y, { width: CW, align: 'justify', lineGap: f.preamble.lineGap });
    doc.moveDown(f.preamble.after);
  }
  if (m.resolved) {
    font(ctx, f.resolved).text(m.resolved, ML, doc.y, { width: CW, underline: f.resolved.underline });
    doc.moveDown(f.resolved.after);
  }

  const para = (text) => {
    font(ctx, f.paragraph).text(text, ML, doc.y, { width: CW, align: 'justify', lineGap: f.paragraph.lineGap });
    doc.moveDown(f.paragraph.after);
  };
  const d = f.directors;
  const directorRows = (list) => {
    let y = doc.y + d.startDy;
    for (const dir of list) {
      const textY = y + d.rowH + d.textDy;
      font(ctx, f.paragraph).text(d.bullet, ML + d.bulletX, textY, { width: d.bulletW });
      doc.font(d.nameFont).fillColor(col(ctx, d.nameColor)).text(dir.name, ML + d.nameX, textY, { width: d.nameW });
      doc.moveTo(ML + d.lineX, textY + d.lineDy).lineTo(PW - MR, textY + d.lineDy)
        .strokeColor(col(ctx, d.lineColor)).lineWidth(d.lineWidth).stroke();
      y += d.rowH;
    }
    doc.y = y + d.after;
  };
  for (const r of m.resolutions) {
    para(r.text);
    if (r.directors) directorRows(r.directors);
  }

  const c = f.certification;
  if (needsBreak(ctx, c.height)) doc.addPage();
  doc.moveDown(c.before);
  const certY = doc.y;
  font(ctx, c.title).text(m.certification.title, ML, certY, { width: CW });
  font(ctx, c.forLine).text(m.certification.forLine, ML, certY + c.forDy, { width: CW });
  const columns = [...m.certification.signers];
  const n = Math.max(c.minColumns, columns.length + (m.certification.seal ? 1 : 0));
  const colW = (CW - c.colGap * (n - 1)) / n;
  const lineY = certY + c.forDy + c.signGap;
  const column = (i, title, sub) => {
    const x = ML + i * (colW + c.colGap);
    font(ctx, c.name).text(title, x, lineY + c.nameDy, { width: colW, align: 'center' });
    font(ctx, c.sub).text(sub, x, lineY + c.subDy, { width: colW, align: 'center' });
  };
  columns.forEach((s, i) => column(i, s.title, s.sub));
  if (m.certification.seal) column(n - 1, m.certification.seal.title, m.certification.seal.sub);

  drawFooters(ctx, opts.footer ?? {});
}

/** Blocks for the HTML and Markdown renditions. */
export function blocks(values, env) {
  const m = boardResolutionModel(values, env);
  const out = [{ type: 'heading', level: 1, text: m.title, align: 'center' }];
  out.push({ type: 'paragraph', text: [m.ref, m.date].filter(Boolean).join('  \n'), align: 'right' });
  if (m.preamble) out.push({ type: 'paragraph', text: `**${m.preamble}**` });
  if (m.resolved) out.push({ type: 'paragraph', text: `**${m.resolved}**`, align: 'left' });
  for (const r of m.resolutions) {
    out.push({ type: 'paragraph', text: r.text });
    if (r.directors) out.push({ type: 'bullets', items: r.directors.map((x) => `**${x.name}**${x.role ? ` (${x.role})` : ''}`) });
  }
  const cert = m.certification;
  out.push({ type: 'paragraph', text: `**${cert.title}**  \n${cert.forLine}`, align: 'left' });
  const cols = [...cert.signers, ...(cert.seal ? [cert.seal] : [])];
  out.push({ type: 'table', columns: cols.map((x, i) => ({ key: `c${i}`, label: x.title, align: 'center' })), rows: [Object.fromEntries(cols.map((x, i) => [`c${i}`, x.sub]))] });
  return out;
}

/** Module exports of `board-resolution`. */
export const boardResolutionModule = Object.freeze({
  computed,
  blocks,
  async renderPdf(pctx, values, env) {
    await drawBoardResolution(pctx, boardResolutionModel(values, env), {
      contact: env.meta.contact, frame: env.params?.frame, footer: { left: '', right: '', ...env.params?.footer },
    });
  },
});
