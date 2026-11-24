// Module code of the memorandum of understanding (src/templates/mou): a Markdown-bodied agreement (body.md for the
// organisation-wide variant, body.event.md for a single event, chosen by the `variant` field) drawn as the legacy v2
// MoU (docs/DISCOVERY.md A8 §12, src/render/pdf/mouFrame.js). The Markdown rendition is the filled body; the PDF and
// HTML renditions parse it (parseMarkdownBlocks). `computed.print` prepares the printable strings the bodies use.
import { mergeStyle } from './blocks.js';
import { blocksToHtml, escapeHtml } from './html/index.js';
import { parseMarkdownBlocks } from './md/parse.js';
import { drawMou, signatureValues, MOU_FRAME } from './pdf/mouFrame.js';
import { textLines, letterMoney } from './letterTemplate.js';
import { percentOf } from './statementTemplate.js';
import { interpolate } from '../workspace/index.js';

const present = (v) => !(v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));
const plain = (n) => String(Number.isInteger(n) ? n : Number(n.toFixed(4)));

/** The brand registration printed for the first party: the one labelled `label`, else the first one. */
function registration(brand, label) {
  const regs = brand.registrations ?? [];
  const r = regs.find((x) => x.label.toLowerCase() === String(label ?? '').toLowerCase()) ?? regs[0];
  return r ? `${r.label}: ${r.value}` : '';
}

/**
 * Printable values for the bodies (`{{print.*}}`): dates, upper-case party names, one-line addresses, the first
 * party's registration, the event details and the fee illustration (`examplePrice` with `feePercent` and `gstPercent`
 * applied, each rounded half up to a minor unit).
 * @param {Record<string, any>} values @param {{ brand: object, fmt: object, params: object }} env
 */
function print(values, env) {
  const { brand, fmt, params } = env;
  const companyAddress = textLines(brand.addresses?.registered).join(', ') || textLines(brand.addresses?.business).join(', ');
  if (!companyAddress) throw new Error(`brand "${brand.id}" has no registered or business address to print for the first party`);
  const partnerAddress = textLines(values.partnerAddress).join(', ');
  if (!partnerAddress) throw new Error('partnerAddress is empty');
  const out = {
    date: values.date ? fmt.date(values.date, 'long') : '',
    company: brand.legalName,
    companyUpper: brand.legalName.toUpperCase(),
    companyRegistration: registration(brand, params.registrationLabel),
    companyAddress,
    partner: values.partnerName ?? '',
    partnerUpper: String(values.partnerName ?? '').toUpperCase(),
    partnerAddress,
    feePercent: present(values.feePercent) ? plain(values.feePercent) : '',
    gstPercent: present(values.gstPercent) ? plain(values.gstPercent) : '',
  };
  if (!Number.isSafeInteger(values.examplePrice) || values.examplePrice < 0) throw new Error('examplePrice must be a non-negative amount');
  if (typeof values.feePercent !== 'number') throw new Error('feePercent is required for the fee illustration');
  {
    const price = values.examplePrice;
    const fee = percentOf(price, values.feePercent);
    const gst = percentOf(fee, values.gstPercent ?? 0);
    const money = (m) => fmt.money(m);
    out.example = { price: money(price), fee: money(fee), gst: money(gst), total: money(price + fee + gst), received: money(price) };
    out.exampleShort = letterMoney(fmt, price);
  }
  return out;
}

/**
 * `event.name`: the engagement's name (input `event.name` wins); the event variant fails without one.
 * @param {Record<string, any>} values
 */
function eventName(values) {
  const name = values.engagement?.name;
  if (values.variant === 'event' && !present(name)) throw new Error('the event variant needs an event name (event.name or an engagement)');
  return present(name) ? name : undefined;
}

export const computed = Object.freeze({ print, eventName });

/** The frame of a variant: MOU_FRAME, then `params.frame`, then `params.variants[<variant>].frame`. */
export function mouFrame(params, variant) {
  return mergeStyle(mergeStyle(MOU_FRAME, params.frame ?? {}), params.variants?.[variant]?.frame ?? {});
}

function watermarkOf(values, env) {
  if (values.watermark !== true) return null;
  const w = env.params.watermark ?? {};
  const text = interpolate(w.text ?? '', { ...env.brand, number: values.number ?? '' });
  return text ? { ...w, text } : null;
}

const blocksOf = (env) => {
  if (typeof env.markdown !== 'string') throw new Error('the MoU template needs a Markdown body (body.md)');
  return parseMarkdownBlocks(env.markdown);
};

/**
 * Draw the PDF (renderPdf contract, docs/TEMPLATES.md).
 * @param {import('./pdf/document.js').PdfContext} pctx @param {Record<string, any>} values @param {object} env
 */
export async function renderPdf(pctx, values, env) {
  drawMou(pctx, blocksOf(env), { frame: mouFrame(env.params, values.variant), watermark: watermarkOf(values, env) });
}

/** Signature cards for the HTML rendition (escaped). */
function cardsHtml(sigs, frame) {
  const s = frame.signature;
  const card = (b) => {
    const vals = signatureValues(b?.lines ?? [], s.fields);
    const rows = s.fields.map((label) => {
      const v = vals[label.toLowerCase()];
      return `<div style="display:flex;gap:4pt;margin-top:7pt;font-size:${s.field.size}pt;font-weight:500;color:${escapeHtml(s.field.color)}">`
        + `<span>${escapeHtml(label)}:</span>${v ? `<span style="font-weight:600;font-size:${s.value.size}pt;color:${escapeHtml(s.value.color)}">${escapeHtml(v)}</span>`
          : `<span style="flex:1;border-bottom:0.5pt solid ${escapeHtml(s.blank.color)}"></span>`}</div>`;
    }).join('');
    return `<div style="flex:1;min-height:${s.cardHeight}pt;box-sizing:border-box;padding:${s.pad}pt;background:${escapeHtml(s.fill)};border:1pt solid ${escapeHtml(s.stroke)};border-radius:${s.radius}pt">`
      + `<div style="font-size:${s.title.size}pt;font-weight:700;color:${escapeHtml(s.title.color)};padding-bottom:${s.title.after / 2}pt;border-bottom:0.5pt solid ${escapeHtml(s.rule.color)}">${escapeHtml(b?.party ?? '')}</div>`
      + `<div style="margin-top:${s.label.dy}pt;font-size:${s.label.size}pt;font-weight:700;color:${escapeHtml(s.label.color)}">${escapeHtml(s.label.text)}</div>`
      + `<div style="width:${s.signLine.length}pt;height:${s.signLine.dy - 4}pt;border-bottom:0.5pt solid ${escapeHtml(s.signLine.color)}"></div>${rows}</div>`;
  };
  const out = [];
  for (let i = 0; i < sigs.length; i += 2) {
    out.push(`<div class="mou-signatures" style="display:flex;gap:${s.gap}pt;margin:${s.dy + 6}pt 0 ${s.rowGap}pt;break-inside:avoid">${card(sigs[i])}${card(sigs[i + 1])}</div>`);
  }
  return out.join('\n');
}

/** HTML block style mirroring MOU_FRAME (a web rendition, not a facsimile of the PDF). */
function htmlStyle(f) {
  const h = (lvl) => ({ font: f.heading[lvl].font, size: f.heading[lvl].size, color: f.heading[lvl].color, lineGap: f.heading[lvl].lineGap,
    before: f.heading[lvl].before, after: f.heading[lvl].after, uppercase: false });
  return {
    heading: { 1: h(1), 2: h(2), 3: h(3) },
    paragraph: { fontSize: f.paragraph.fontSize, lineGap: f.paragraph.lineGap, color: f.paragraph.color, regularFont: 'Regular', boldFont: 'Bold', moveDown: f.paragraph.moveDown },
    bullets: { bullet: f.bullets.bullet, bulletX: f.bullets.bulletX, indent: f.bullets.indent, itemMoveDown: f.bullets.itemMoveDown, moveDown: f.bullets.moveDown },
    table: {
      header: { fill: f.table.header.fill, color: f.table.header.color, size: f.table.header.size, font: 'Bold' },
      row: { size: f.table.row.size, color: f.table.row.color, fills: f.table.row.fills, padX: f.table.padX, padY: f.table.padY },
    },
    divider: { color: f.divider.color, lineWidth: f.divider.lineWidth },
  };
}

/**
 * Standalone HTML: the parsed body without letterhead or footer, signature sections as side-by-side cards, and the
 * watermark (when on) as a fixed diagonal overlay.
 * @param {Record<string, any>} values @param {object} env
 */
export function renderHtml(values, env) {
  const f = mouFrame(env.params, values.variant);
  const blocks = blocksOf(env);
  const sigs = blocks.filter((b) => b.type === 'signature');
  const body = blocks.filter((b) => b.type !== 'signature');
  if (sigs.length) body.push({ type: 'custom', name: 'signatures', data: { html: cardsHtml(sigs, f) } });
  const wm = watermarkOf(values, env);
  if (wm) {
    body.unshift({ type: 'custom', name: 'watermark', data: { html: `<div aria-hidden="true" style="position:fixed;top:45%;left:0;right:0;text-align:center;font-size:${wm.size ?? 38}pt;font-weight:700;color:#555555;opacity:${wm.opacity ?? 0.14};transform:rotate(${wm.angle ?? -30}deg);pointer-events:none">${escapeHtml(wm.text)}</div>` } });
  }
  const title = values.partnerName ? `${env.meta.title} - ${values.partnerName}` : env.meta.title;
  return blocksToHtml(body, {
    brand: env.brand, ws: env.ctx?.ws, title, style: htmlStyle(f), standalone: true, profileId: env.meta.layoutProfile,
    contact: env.meta.contact ?? 'default', letterhead: false, footer: false,
  });
}
