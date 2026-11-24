// HTML rendition of the invoice family frame: the same model as the PDF (src/render/pdf/invoiceFrame.js), laid out
// with CSS in pt using the frame's sizes, fonts and colours. A web rendition, not a line-for-line facsimile.
import { getProfile } from '../pdf/profiles.js';
import { INVOICE_FRAME_DEFAULTS, mergeStyle } from '../pdf/invoiceFrame.js';
import { LINE_HEIGHT_RATIO, cssColour, escapeHtml, fontFaces, fontWeight, imageUrl, pt } from './index.js';

const e = escapeHtml;
const br = (lines) => lines.map(e).join('<br>');

/**
 * Render an invoice model (`invoiceModel(values, env)`) as a complete HTML document.
 * @param {ReturnType<typeof import('../pdf/invoiceFrame.js').invoiceModel>} model
 * @param {{ brand: object, ws?: object, title?: string, frame?: object, standalone?: boolean, assetBase?: string }} opts
 * @returns {string}
 */
export function invoiceToHtml(model, { brand, ws, title, frame, standalone = true, assetBase = '/assets' }) {
  const S = mergeStyle(INVOICE_FRAME_DEFAULTS, frame);
  const profile = getProfile('invoice', brand.layoutProfiles);
  const palette = brand.palette ?? {};
  const c = (v) => cssColour(palette[v] ?? v);
  const lh = (size, gap = 0) => pt(size * LINE_HEIGHT_RATIO + gap);
  const font = (name, size, colour) => `font-weight: ${fontWeight(name)}; font-size: ${pt(size)}; line-height: ${lh(size)}; color: ${c(colour)};`;
  const urlOpts = { standalone, assetBase };
  const logo = imageUrl(ws, brand, 'assets.logo', urlOpts);
  const sig = model.signatory ? imageUrl(ws, brand, `signature:${model.signatory.id}`, urlOpts) : null;
  const { header: TH, row: R } = S.table;
  const P = S.parties;
  const SM = S.summary;
  const descFont = model.descriptionFont ?? R.descriptionFont;
  const rowH = model.rowHeight === 'auto' ? R.minHeight : model.rowHeight;
  const fills = (R.fills ?? []).map((f, i, all) => `.items tbody tr:nth-child(${all.length}n+${i + 1}) { background: ${c(f)}; }`).join('\n');

  const css = `@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { font-family: 'DossierBody', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${pt(profile.PW)}; min-height: ${pt(profile.PH)}; margin: 0 auto; padding: ${pt(profile.MT)} ${pt(profile.MR)} ${pt(profile.MB + 70)} ${pt(profile.ML)}; background: #ffffff; }
.head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: ${pt(10)}; border-bottom: ${pt(S.rule.width)} solid ${c(S.rule.color)}; }
.head img { height: ${pt(S.logo.height)}; width: auto; }
.head .meta { text-align: right; }
.head h1 { margin: ${pt(S.title.dy)} 0 ${pt(2)}; ${font(S.title.font, S.title.size, S.title.color)} }
.head .row { ${font(S.meta.labelFont, S.meta.size, S.meta.labelColor)} }
.head .row .v { color: ${c(S.meta.color)}; display: inline-block; min-width: ${pt(S.meta.labelInset)}; }
.head .row .num { font-weight: ${fontWeight(S.meta.numberFont)}; }
.head .row .date { font-weight: ${fontWeight(S.meta.dateFont)}; }
.parties { display: grid; grid-template-columns: 1fr 1fr; column-gap: ${pt(P.colGap)}; padding: ${pt(P.gap)} 0 ${pt(P.ruleGap)}; min-height: ${pt(P.minHeight + P.gap)}; border-bottom: ${pt(S.rule.width)} solid ${c(S.rule.color)}; }
.parties h2 { margin: 0 0 ${pt(P.nameDy - P.headingSize * LINE_HEIGHT_RATIO)}; ${font(P.headingFont, P.headingSize, P.headingColor)} }
.parties .name { ${font(P.nameFont, P.nameSize, P.nameColor)} }
.parties .addr { margin-top: ${pt(P.addressGap)}; ${font(P.addressFont, P.addressSize, P.addressColor)} line-height: ${lh(P.addressSize, P.lineGap)}; }
.parties .contacts { margin-top: ${pt(P.contactGap)}; font-size: ${pt(P.contactSize)}; line-height: ${lh(P.contactSize, P.contactStep)}; }
.parties .contacts .k { font-weight: ${fontWeight(P.contactLabelFont)}; color: ${c(P.contactLabelColor)}; }
.parties .contacts .v { font-weight: ${fontWeight(P.contactValueFont)}; color: ${c(P.contactValueColor)}; }
table.items { width: 100%; border-collapse: collapse; margin-top: ${pt(S.table.gap)}; border-bottom: ${pt(S.rule.width)} solid ${c(S.table.ruleColor)}; }
.items th { background: ${c(TH.fill)}; ${font(TH.font, TH.size, TH.color)} height: ${pt(TH.height)}; padding: 0; text-align: left; }
.items td { font-size: ${pt(R.size)}; line-height: ${lh(R.size)}; height: ${pt(rowH)}; padding: ${pt(R.textDy)} 0; vertical-align: top; }
.items .right { text-align: right; padding-right: ${pt(8)}; }
.items .center { text-align: center; }
.items .index { padding-left: ${pt(8)}; font-weight: ${fontWeight(R.indexFont)}; color: ${c(R.indexColor)}; }
.items .description { padding-right: ${pt(R.descriptionPadRight)}; font-weight: ${fontWeight(descFont)}; color: ${c(R.descriptionColor)}; white-space: pre-line; line-height: ${lh(R.size, R.descriptionLineGap ?? 0)}; }
.items .code { font-weight: ${fontWeight(R.codeFont)}; color: ${c(R.codeColor)}; }
.items .amount { font-weight: ${fontWeight(R.amountFont)}; color: ${c(R.amountColor)}; }
${fills}
.summary { display: flex; justify-content: space-between; gap: ${pt(20)}; margin-top: ${pt(SM.gap)}; padding-bottom: ${pt(S.signature.gap)}; border-bottom: ${pt(S.rule.width)} solid ${c(S.rule.color)}; }
.bank h3 { margin: 0 0 ${pt(SM.bank.linesDy - SM.bank.headingSize * LINE_HEIGHT_RATIO)}; ${font(SM.bank.headingFont, SM.bank.headingSize, SM.bank.headingColor)} }
.bank div { font-size: ${pt(SM.bank.size)}; line-height: ${lh(SM.bank.size, SM.bank.step)}; }
.bank .k { font-weight: ${fontWeight(SM.bank.labelFont)}; color: ${c(SM.bank.labelColor)}; }
.bank .v { font-weight: ${fontWeight(SM.bank.valueFont)}; color: ${c(SM.bank.valueColor)}; }
.ack { flex: 1; min-height: ${pt(SM.acknowledgement.height)}; padding: ${pt(SM.acknowledgement.pad)}; border: ${pt(SM.acknowledgement.strokeWidth)} solid ${c(SM.acknowledgement.stroke)}; border-radius: ${pt(SM.acknowledgement.radius)}; }
.ack h3 { margin: 0 0 ${pt(SM.acknowledgement.textDy - SM.acknowledgement.pad - SM.acknowledgement.titleSize * LINE_HEIGHT_RATIO)}; ${font(SM.acknowledgement.titleFont, SM.acknowledgement.titleSize, SM.acknowledgement.titleColor)} }
.ack p { margin: 0; ${font(SM.acknowledgement.textFont, SM.acknowledgement.textSize, SM.acknowledgement.textColor)} line-height: ${lh(SM.acknowledgement.textSize, SM.acknowledgement.lineGap)}; }
.calc { width: ${pt(SM.columnWidth)}; flex: none; margin-left: auto; }
.calc .r { display: flex; justify-content: space-between; height: ${pt(SM.calc.rowHeight)}; ${font(SM.calc.font, SM.calc.size, SM.calc.labelColor)} }
.calc .r .v { color: ${c(SM.calc.valueColor)}; }
.calc .total { display: flex; justify-content: space-between; align-items: center; margin: ${pt(SM.total.gap)} 0 0 ${pt(-SM.total.padLeft)}; height: ${pt(SM.total.height)}; padding: 0 ${pt(SM.total.padLeft)}; border-radius: ${pt(SM.total.radius)}; background: ${c(SM.total.fill)}; ${font(SM.total.font, SM.total.size, SM.total.color)} }
.sign { width: ${pt(S.signature.width)}; margin: ${pt(S.signature.ruleGap)} 0 0 auto; text-align: right; }
.sign .for { ${font(S.signature.forStyle.font, S.signature.forStyle.size, S.signature.forStyle.color)} }
.sign img { display: block; height: ${pt(S.signature.imageHeight)}; width: auto; margin: ${pt(2)} 0 ${pt(S.signature.offsets.name)} auto; }
.sign .name { ${font(S.signature.nameStyle.font, S.signature.nameStyle.size, S.signature.nameStyle.color)} }
.sign .title { ${font(S.signature.titleStyle.font, S.signature.titleStyle.size, S.signature.titleStyle.color)} }
.bottom { position: absolute; left: ${pt(profile.ML)}; right: ${pt(profile.MR)}; bottom: ${pt(profile.MB)}; }
.bottom h4 { margin: 0; ${font(S.bottom.headingFont, S.bottom.headingSize, S.bottom.headingColor)} }
.bottom p { margin: ${pt(S.bottom.textDy - S.bottom.headingSize * LINE_HEIGHT_RATIO)} 0 ${pt(8)}; ${font(S.bottom.textFont, S.bottom.textSize, S.bottom.textColor)} line-height: ${lh(S.bottom.textSize, S.bottom.lineGap)}; }
.bottom .thanks { padding-top: ${pt(-S.bottom.ruleDy)}; border-top: ${pt(S.rule.width)} solid ${c(S.bottom.ruleColor)}; text-align: center; ${font(S.bottom.thankYouFont, S.bottom.thankYouSize, S.bottom.thankYouColor)} }
@media print { .page { margin: 0; } }`;

  const cls = (col) => [col.key === 'index' ? 'index' : col.key === 'description' ? 'description' : col.key === 'amount' ? 'amount' : 'code',
    col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : ''].filter(Boolean).join(' ');
  const head = model.columns.map((col) => `<th class="${col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : col.key === 'index' ? 'index' : ''}" style="width: ${pt(col.width ?? 0)}">${e(col.label)}</th>`).join('');
  const rows = model.rows.map((r) => `<tr>${model.columns.map((col) => `<td class="${cls(col)}">${e(r[col.key])}</td>`).join('')}</tr>`).join('\n');
  const left = model.bank
    ? `<div class="bank"><h3>${e(model.bank.title)}</h3>${model.bank.lines.map((l) => `<div><span class="k">${e(l.label)}: </span><span class="v">${e(l.value)}</span></div>`).join('')}</div>`
    : model.acknowledgement ? `<div class="ack"><h3>${e(model.acknowledgement.title)}</h3><p>${e(model.acknowledgement.text)}</p></div>` : '<div></div>';
  const calc = model.calc.map((r) => `<div class="r"><span>${e(r.label)}</span><span class="v">${e(r.value)}</span></div>`).join('');
  const s = model.signatory;
  const sign = s ? `<div class="sign"><div class="for">${e(s.forLine)}</div>${sig ? `<img src="${e(sig)}" alt="${e(`Signature of ${s.name}`)}">` : ''}`
    + `<div class="name">${e(s.name)}</div>${s.title ? `<div class="title">${e(s.title)}</div>` : ''}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title ?? model.title)}</title>
<style>
${fontFaces(ws, brand, urlOpts)}
${css}
</style>
</head>
<body>
<div class="page">
<header class="head">${logo ? `<img src="${e(logo)}" alt="${e(brand.shortName ?? brand.legalName)}">` : '<span></span>'}<div class="meta"><h1>${e(model.title)}</h1>`
    + `<div class="row">${e(model.number.label)}<span class="v num">${e(model.number.value)}</span></div>`
    + `<div class="row">${e(model.date.label)}<span class="v date">${e(model.date.value)}</span></div></div></header>
<section class="parties"><div><h2>${e(model.party.label)}</h2><div class="name">${e(model.party.name)}</div><div class="addr">${br(model.party.address)}</div></div>`
    + `<div><h2>${e(model.from.label)}</h2><div class="name">${e(model.from.name)}</div><div class="addr">${br(model.from.address)}</div>`
    + `<div class="contacts">${model.from.contacts.map((x) => `<div><span class="k">${e(x.label)}: </span><span class="v">${e(x.value)}</span></div>`).join('')}</div></div></section>
<table class="items"><thead><tr>${head}</tr></thead><tbody>
${rows}
</tbody></table>
<section class="summary">${left}<div class="calc">${calc}<div class="total"><span>${e(model.total.label)}</span><span>${e(model.total.value)}</span></div></div></section>
${sign}
<footer class="bottom">${model.declaration.text ? `<h4>${e(model.declaration.title)}</h4><p>${e(model.declaration.text)}</p>` : ''}${model.thankYou ? `<div class="thanks">${e(model.thankYou)}</div>` : ''}</footer>
</div>
</body>
</html>
`;
}
