// Shared module code of the letter-family templates (offer letter, internship offer, certificates, relieving letter):
// legacy layouts from docs/DISCOVERY.md A8 §2-4. Every template builds blocks from its params and values; the PDF is
// the letterhead, renderBlocksPdf with the template's style and the page footers. Wording lives in template.json
// params (overridable per brand with `templateParams` and per document with fields), never here.
import { interpolate } from '../workspace/index.js';
import { escapeHtml } from './html/index.js';
import { attachLetterhead, brandScope, drawFooters, renderBlocksPdf } from './pdf/index.js';
import { LOCALE_DEFAULTS } from './pdf/format.js';
import { mergeStyle, paletteColour } from './blocks.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Page-1 layout of the offer family (A8 §2): positions are below `MT + CP`, gaps in lines (`moveDown`). */
export const OPENING_STYLE = Object.freeze({
  dateDy: 20, toDy: 45,
  date: Object.freeze({ font: 'BodyBold', size: 10, color: 'ink' }),
  to: Object.freeze({ font: 'BodyBold', size: 10, color: 'ink', after: 0.5 }),
  name: Object.freeze({ font: 'BodyBold', size: 10.5, color: 'ink', after: 0.4 }),
  address: Object.freeze({ font: 'BodyRegular', size: 10, color: 'body', lineGap: 3, after: 2.2 }),
  subject: Object.freeze({ font: 'BodyBold', size: 12, color: 'ink', lineGap: 2.5, after: 2.0 }),
  salutation: Object.freeze({ font: 'BodyRegular', size: 10.5, color: 'body', after: 1.5 }),
});

/** Certificate head (A8 §4): ref / date line at `MT + CP + 25`, title, salutation. */
export const CERTIFICATE_HEAD_STYLE = Object.freeze({
  dy: 25,
  line: Object.freeze({ font: 'Bold', size: 9.5, color: 'ink', after: 3.0 }),
  title: Object.freeze({ font: 'ExtraBold', size: 14, color: 'ink', after: 2.5 }),
  salutation: Object.freeze({ font: 'Bold', size: 10, color: 'ink', after: 1.0 }),
});

/** Offer-letter block style (A8 §2): BLOCK_STYLE_DEFAULTS are the offer-letter values already; tables sit on spacers. */
export const OFFER_STYLE = Object.freeze({
  opening: OPENING_STYLE,
  table: { before: 0, after: 0 },
  signature: { gap: 0, after: 0 },
});

/** Internship offer (A8 §3): body lineGap 4, paragraphs 0.7 apart, lines need 5 pt more before a page break. */
export const INTERNSHIP_STYLE = Object.freeze({
  opening: OPENING_STYLE,
  paragraph: { lineGap: 4, moveDown: 0.7, breakPad: 5 },
  heading: { 2: { breakMin: 45 } },
  signature: { gap: 0, after: 0 },
});

/** Certificates and relieving letter (A8 §4): Regular/Bold 10, lineGap 5, signature image h50, Bold 10 "For" line. */
export const CERTIFICATE_STYLE = Object.freeze({
  certificateHead: CERTIFICATE_HEAD_STYLE,
  paragraph: { fontSize: 10, lineGap: 5, moveDown: 1.2, regularFont: 'Regular', boldFont: 'Bold' },
  signature: {
    gap: 0, after: 0,
    block: { imageHeight: 50, forStyle: { font: 'Bold', size: 10 }, nameStyle: { font: 'Bold', size: 10 }, titleStyle: { font: 'Medium', size: 9 } },
  },
});

/** Footer of the offer family (brand footer: contact, centre text, page n of N) and of certificates (no centre text). */
export const OFFER_FOOTER = Object.freeze({});
export const CERTIFICATE_FOOTER = Object.freeze({ center: '' });

const getPath = (obj, path) => String(path).split('.').reduce((v, k) => (v != null && typeof v === 'object' ? v[k] : undefined), obj);
const setPath = (obj, path, value) => {
  const parts = path.split('.');
  let o = obj;
  for (const k of parts.slice(0, -1)) o = isPlainObject(o[k]) ? o[k] : (o[k] = {});
  o[parts.at(-1)] = value;
};
const present = (v) => !(v == null || v === false || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0));

/**
 * Lines of an address-like value: a list of lines, or text with line breaks.
 * @param {unknown} v
 * @returns {string[]}
 */
export function textLines(v) {
  if (Array.isArray(v)) return v.map((l) => String(l ?? '').trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return [];
}

/**
 * Money for letters: `₹1,20,000` for whole amounts, `₹1,20,000.50` otherwise (legacy letters print no paise).
 * @param {object} fmt @param {number} minor @param {{ symbol?: boolean }} [opts]
 */
export function letterMoney(fmt, minor, { symbol = true } = {}) {
  const decimals = minor % 100 === 0 ? 0 : 2;
  return symbol ? fmt.money(minor, { decimals }) : fmt.number(minor, { decimals });
}

/**
 * The interpolation scope of a letter: the brand (with `{contact.*}`), `{company}` (legal name), `{currency}`, every
 * field value formatted for print (dates long, money `₹1,20,000` plus `{<name>Words}`, entities and signatories by
 * name, lists of lines joined by line breaks), `{fullName}` (honorific + recipient name) and `{firstName}`; `extra`
 * wins.
 * @param {Record<string, any>} values @param {{ brand: object, meta: object, fmt: object, ctx?: object }} env
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, unknown>}
 */
export function letterScope(values, env, extra = {}) {
  const { brand, meta, fmt } = env;
  const scope = {
    ...brandScope(brand, meta.contact ?? 'default'),
    company: brand.legalName,
    currency: env.ctx?.ws?.config?.locale?.currencySymbol ?? LOCALE_DEFAULTS.currencySymbol,
  };
  for (const f of meta.fields ?? []) {
    if (f.source === 'brand') continue;
    const v = getPath(values, f.name);
    if (v === undefined || v === null) continue;
    let out;
    if (f.type === 'date') out = fmt.date(v, 'long');
    else if (f.type === 'money' && Number.isInteger(v)) {
      out = letterMoney(fmt, v);
      setPath(scope, `${f.name}Words`, fmt.amountInWords(Math.abs(v)));
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out = v.join('\n');
    else if (isPlainObject(v) && typeof v.name === 'string' && (v.kind || v.id)) out = v.name;
    else continue;
    setPath(scope, f.name, out);
  }
  const name = String(getPath(values, 'recipient.name') ?? '').trim();
  const honorific = String(values.honorific ?? '').trim();
  scope.fullName = honorific && name ? `${honorific} ${name}` : name;
  scope.firstName = String(values.salutationName ?? '').trim() || name.split(/\s+/)[0] || '';
  return Object.assign(scope, extra);
}

/** Does an item with `when` / `unless` (a value path, or a list of paths that must all hold) apply to these values? */
function applies(item, values) {
  const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  return list(item.when).every((p) => present(getPath(values, p))) && !list(item.unless).some((p) => present(getPath(values, p)));
}

/**
 * Paragraph blocks from text items: a string, or `{ text, when?, unless?, align?, moveDown? }`. Text is interpolated.
 * @param {Array<string|object>} items @param {object} scope @param {object} values
 * @param {{ moveDown?: number, align?: string }} [defaults] applied to every paragraph that does not set its own
 * @returns {object[]}
 */
export function paragraphBlocks(items, scope, values, defaults = {}) {
  const out = [];
  for (const raw of items ?? []) {
    const item = typeof raw === 'string' ? { text: raw } : raw;
    if (!isPlainObject(item) || !applies(item, values)) continue;
    const b = { type: 'paragraph', text: interpolate(item.text, scope) };
    const align = item.align ?? defaults.align;
    if (align) b.align = align;
    const moveDown = item.moveDown ?? defaults.moveDown;
    if (moveDown !== undefined) b.style = { moveDown };
    out.push(b);
  }
  return out;
}

/**
 * Clause blocks: per clause a level-2 heading (`1. Title` when `number`), its `paragraphs`, a bullet list (`bullets`,
 * or the value list named by `bulletsFrom` when that is non-empty) and the `after` paragraphs. Clauses and paragraphs
 * may carry `when` / `unless` (value paths). Text is interpolated with `scope`.
 * @param {Array<{ title: string, paragraphs?: Array<string|object>, bullets?: string[], bulletsFrom?: string,
 *   after?: Array<string|object>, when?: string|string[], unless?: string|string[] }>} clauses
 * @param {object} scope @param {object} values @param {{ number?: boolean }} [opts]
 * @returns {object[]}
 */
export function clauseBlocks(clauses, scope, values, { number = true } = {}) {
  const out = [];
  let n = 0;
  for (const c of clauses ?? []) {
    if (!applies(c, values)) continue;
    n++;
    const title = interpolate(c.title, scope);
    out.push({ type: 'heading', level: 2, text: number ? `${n}. ${title}` : title });
    out.push(...paragraphBlocks(c.paragraphs, scope, values));
    const fromValues = c.bulletsFrom ? getPath(values, c.bulletsFrom) : undefined;
    const bullets = Array.isArray(fromValues) && fromValues.length ? fromValues : (c.bullets ?? []);
    if (bullets.length) out.push({ type: 'bullets', items: bullets.map((b) => interpolate(String(b), scope)) });
    out.push(...paragraphBlocks(c.after, scope, values));
  }
  return out;
}

/**
 * Check a clause list (template params or the `clauses` field); throws with the first problem.
 * @param {unknown} clauses
 * @returns {true}
 */
export function checkClauses(clauses) {
  if (!Array.isArray(clauses)) throw new Error('clauses must be a list of { title, paragraphs?, bullets?, after? }');
  const texts = (v, at) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) throw new Error(`${at} must be a list`);
    v.forEach((t, i) => {
      if (typeof t === 'string') return;
      if (!isPlainObject(t) || typeof t.text !== 'string') throw new Error(`${at}.${i} must be text or { text }`);
    });
  };
  clauses.forEach((c, i) => {
    if (!isPlainObject(c) || typeof c.title !== 'string' || !c.title.trim()) throw new Error(`clauses.${i}.title is required`);
    texts(c.paragraphs, `clauses.${i}.paragraphs`);
    texts(c.after, `clauses.${i}.after`);
    if (c.bullets !== undefined && !(Array.isArray(c.bullets) && c.bullets.every((b) => typeof b === 'string'))) {
      throw new Error(`clauses.${i}.bullets must be a list of text`);
    }
  });
  return true;
}

/**
 * Check a paragraph list (params or a field); throws with the first problem.
 * @param {unknown} list @param {string} name
 */
export function checkParagraphs(list, name) {
  if (!Array.isArray(list) || !list.every((t) => typeof t === 'string' || (isPlainObject(t) && typeof t.text === 'string'))) {
    throw new Error(`${name} must be a list of text or { text }`);
  }
  return true;
}

/** The printed reference number: `DRAFT` in a preview of a numbered template, the number, or '' when unnumbered. */
export function referenceNumber(values, env) {
  const { meta, brand } = env;
  const numbered = Boolean(meta.numbering && (meta.numbering.series !== 'brand' || brand.series?.[meta.id]));
  if (env.draft) return numbered ? 'DRAFT' : '';
  return values.number ?? '';
}

/**
 * The signature block: the signatory, "For …" from `params.signature.forLine`, extra lines (`params.signature.lines`),
 * the brand seal when `values.seal` is true; without the seal the legacy no-seal offsets (image +16, name +10).
 * @param {object} values @param {object} params @param {object} scope
 */
export function signatureBlock(values, params, scope) {
  const sig = params.signature ?? {};
  const block = {
    type: 'signature',
    signatoryId: values.signatory.id,
    party: interpolate(sig.forLine ?? 'For {legalName}', scope),
    lines: (sig.lines ?? []).map((l) => interpolate(l, scope)),
  };
  if (values.seal !== true) block.style = { block: { seal: null, offsets: sig.noSealOffsets ?? { image: 16, name: 10 } } };
  return block;
}

const esc = escapeHtml;
const htmlLines = (lines) => lines.map(esc).join('<br>');

/**
 * The offer-family opening (A8 §2 page 1) as a custom block: reference and date line, "To," with the name and
 * address, the centred subject and the salutation.
 * @param {{ ref?: string, date: string, to: string, name: string, address: string[], subject: string, salutation: string }} d
 */
export function openingBlock(d) {
  const md = [
    [d.ref, d.date].filter(Boolean).join('  \n'),
    [`**${d.to}**`, `**${d.name}**`, ...d.address].join('  \n'),
    `**${d.subject}**`,
    d.salutation,
  ].filter(Boolean).join('\n\n');
  const html = `<div class="letter-opening">`
    + `<p style="display: flex; justify-content: space-between"><strong>${esc(d.ref ?? '')}</strong><strong>${esc(d.date)}</strong></p>`
    + `<p><strong>${esc(d.to)}</strong><br><strong>${esc(d.name)}</strong>${d.address.length ? `<br>${htmlLines(d.address)}` : ''}</p>`
    + `<p style="text-align: center"><strong>${esc(d.subject)}</strong></p>`
    + `<p>${esc(d.salutation)}</p></div>`;
  return { type: 'custom', name: 'letterOpening', data: { ...d, md, html } };
}

/**
 * The certificate head (A8 §4) as a custom block: reference left and date right on one line, the centred title and
 * the salutation.
 * @param {{ ref?: string, date: string, title: string, salutation: string }} d
 */
export function certificateHeadBlock(d) {
  const md = [[d.ref, d.date].filter(Boolean).join('  \n'), `# ${d.title}`, `**${d.salutation}**`].filter(Boolean).join('\n\n');
  const html = `<div class="certificate-head">`
    + `<p style="display: flex; justify-content: space-between"><strong>${esc(d.ref ?? '')}</strong><strong>${esc(d.date)}</strong></p>`
    + `<h1 style="text-align: center">${esc(d.title)}</h1><p><strong>${esc(d.salutation)}</strong></p></div>`;
  return { type: 'custom', name: 'certificateHead', data: { ...d, md, html } };
}

const setFont = (ctx, o) => ctx.doc.font(o.font).fontSize(o.size).fillColor(paletteColour(ctx.palette, o.color));

/** PDF draw functions for the letter custom blocks (`pdfCustom`). */
export const LETTER_PDF_CUSTOM = Object.freeze({
  /** Offer-family page 1 head; `style.opening` (OPENING_STYLE). */
  letterOpening(ctx, d, style) {
    const o = style.opening ?? OPENING_STYLE;
    const { doc, profile } = ctx;
    const { ML, CW, MT, CP } = profile;
    const top = MT + (CP ?? 0);
    const y = top + o.dateDy;
    setFont(ctx, o.date);
    if (d.ref) doc.text(d.ref, ML, y);
    doc.text(d.date, ML, y, { align: 'right', width: CW });
    doc.y = top + o.toDy;
    setFont(ctx, o.to).text(d.to, ML, doc.y).moveDown(o.to.after);
    setFont(ctx, o.name).text(d.name, ML, doc.y).moveDown(o.name.after);
    setFont(ctx, o.address);
    for (const line of d.address ?? []) doc.text(line, ML, doc.y, { lineGap: o.address.lineGap });
    doc.moveDown(o.address.after);
    setFont(ctx, o.subject).text(d.subject, ML, doc.y, { align: 'center', width: CW, lineGap: o.subject.lineGap });
    doc.moveDown(o.subject.after);
    setFont(ctx, o.salutation).text(d.salutation, ML, doc.y);
    doc.moveDown(o.salutation.after);
  },
  /** Certificate head; `style.certificateHead` (CERTIFICATE_HEAD_STYLE). */
  certificateHead(ctx, d, style) {
    const o = style.certificateHead ?? CERTIFICATE_HEAD_STYLE;
    const { doc, profile } = ctx;
    const { ML, CW, MT, CP } = profile;
    const y = MT + (CP ?? 0) + o.dy;
    setFont(ctx, o.line);
    if (d.ref) doc.text(d.ref, ML, y);
    doc.text(d.date, ML, y, { align: 'right', width: CW });
    doc.moveDown(o.line.after);
    setFont(ctx, o.title).text(d.title, ML, doc.y, { align: 'center', width: CW });
    doc.moveDown(o.title.after);
    setFont(ctx, o.salutation).text(d.salutation, ML, doc.y);
    doc.moveDown(o.salutation.after);
  },
});

/**
 * A template module's `renderPdf`: the letterhead (template contact), the blocks from `build(values, env)` drawn with
 * `style` (with `params.style` deep-merged over it, e.g. `{ "heading": { "2": { "breakMin": 45 } } }`), and the
 * footers (`footer` options for drawFooters, with `params.footer` over them).
 * @param {(values: object, env: object) => object[]} build @param {{ style: object, footer?: object }} opts
 */
export function letterRenderPdf(build, { style, footer = {} }) {
  return async (pctx, values, env) => {
    const p = env.params ?? {};
    await attachLetterhead(pctx, { contact: env.meta.contact });
    await renderBlocksPdf(pctx, build(values, env), mergeStyle(style, p.style ?? {}), { custom: LETTER_PDF_CUSTOM });
    drawFooters(pctx, { ...footer, ...p.footer });
  };
}

/** Give the last paragraph block of a list its own moveDown (gap before what follows). */
export function withLastMoveDown(blocks, moveDown) {
  const i = blocks.findLastIndex((b) => b.type === 'paragraph');
  if (i >= 0) blocks[i] = { ...blocks[i], style: { ...blocks[i].style, moveDown } };
  return blocks;
}

/**
 * `computed:content`: checks the text lists a letter prints (params, or the `opening` / `clauses` / `paragraphs`
 * fields that replace them) so a malformed list is a field error, not a render failure.
 * @param {object} values @param {{ params: object }} env
 * @returns {true}
 */
export function checkContent(values, env) {
  const p = env.params ?? {};
  if (values.clauses !== undefined || p.clauses !== undefined) checkClauses(values.clauses ?? p.clauses);
  for (const key of ['opening', 'paragraphs']) {
    const list = values[key] ?? p[key];
    if (list !== undefined) checkParagraphs(list, key);
  }
  for (const key of ['responsibilities', 'documents']) {
    const list = values[key];
    if (list !== undefined && !(Array.isArray(list) && list.every((x) => typeof x === 'string'))) throw new Error(`${key} must be a list of text`);
  }
  return true;
}

/**
 * Offer-family document (A8 §2-3): page 1 (date, addressee, subject, salutation, opening paragraphs 1.2 lines apart),
 * a forced page break, the terms heading and clauses, then `annexure(values, env, scope)` blocks on their own page when
 * given, then the acceptance page (paragraphs, sign-off fields, closing line) with the signature block.
 * Params: `dateLabel`, `toLabel`, `subject` (+ `subjectUppercase`), `salutation`, `opening`, `openingMoveDown`,
 * `termsTitle`, `numberClauses`, `clauses`, `acceptance` `{ title, paragraphs, fields, closing, gaps }`, `signature`.
 * @param {object} values @param {object} env
 * @param {{ extra?: Record<string, unknown>, annexure?: (values: object, env: object, scope: object) => object[] }} [opts]
 * @returns {object[]}
 */
export function offerFamilyBlocks(values, env, { extra = {}, annexure } = {}) {
  const p = env.params ?? {};
  const ref = referenceNumber(values, env);
  const scope = letterScope(values, env, { number: ref, ...extra });
  const fill = (t) => interpolate(t ?? '', scope);
  const subject = fill(p.subject);
  const out = [openingBlock({
    ref: ref ? fill(p.refLabel ?? 'Ref: {number}') : '',
    date: fill(p.dateLabel ?? 'Date: {date}'),
    to: fill(p.toLabel ?? 'To,'),
    name: String(values.recipient?.name ?? ''),
    address: textLines(values.recipient?.address),
    subject: p.subjectUppercase === false ? subject : subject.toUpperCase(),
    salutation: fill(p.salutation ?? 'Dear {firstName},'),
  })];
  out.push(...paragraphBlocks(values.opening ?? p.opening, scope, values, { moveDown: p.openingMoveDown ?? 1.2 }));
  out.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: fill(p.termsTitle) });
  out.push(...clauseBlocks(values.clauses ?? p.clauses, scope, values, { number: p.numberClauses !== false }));
  if (annexure) out.push({ type: 'pageBreak' }, ...annexure(values, env, scope));

  const a = p.acceptance ?? {};
  const gaps = { afterParagraphs: 0.4, afterFields: 0.6, beforeSignature: 1.2, ...a.gaps };
  out.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: fill(a.title) });
  out.push(...paragraphBlocks(a.paragraphs, scope, values, { align: 'left' }), { type: 'spacer', lines: gaps.afterParagraphs });
  out.push(...paragraphBlocks(a.fields, scope, values, { align: 'left' }), { type: 'spacer', lines: gaps.afterFields });
  out.push(...paragraphBlocks(a.closing ? [a.closing] : [], scope, values, { align: 'left' }), { type: 'spacer', lines: gaps.beforeSignature });
  out.push(signatureBlock(values, p, scope));
  return out;
}

/**
 * Certificate-style document (A8 §4; also the relieving letter): reference and date line, title, salutation, the
 * paragraphs (`paragraphs` field, else `params.paragraphs`; the last one `params.closingMoveDown` 2.2 lines above the
 * signature) and the signature block. Params: `refLabel`, `dateLabel`, `title`, `salutation`, `paragraphs`, `signature`.
 * @param {object} values @param {object} env @param {{ extra?: Record<string, unknown> }} [opts]
 * @returns {object[]}
 */
export function certificateBlocks(values, env, { extra = {} } = {}) {
  const p = env.params ?? {};
  const ref = referenceNumber(values, env);
  const scope = letterScope(values, env, { number: ref, ...extra });
  const fill = (t) => interpolate(t ?? '', scope);
  const out = [certificateHeadBlock({
    ref: ref ? fill(p.refLabel ?? 'Ref: {number}') : '',
    date: fill(p.dateLabel ?? 'Date: {date}'),
    title: fill(p.title),
    salutation: fill(p.salutation ?? 'To Whom It May Concern,'),
  })];
  out.push(...withLastMoveDown(paragraphBlocks(values.paragraphs ?? p.paragraphs, scope, values), p.closingMoveDown ?? 2.2));
  out.push(signatureBlock(values, p, scope));
  return out;
}

/** Module exports shared by the certificate-style templates (internship and experience certificates, relieving letter). */
export const certificateModule = Object.freeze({
  style: CERTIFICATE_STYLE,
  pdfCustom: LETTER_PDF_CUSTOM,
  computed: Object.freeze({ content: checkContent }),
  blocks: (values, env) => certificateBlocks(values, env),
  renderPdf: letterRenderPdf((values, env) => certificateBlocks(values, env), { style: CERTIFICATE_STYLE, footer: CERTIFICATE_FOOTER }),
});
