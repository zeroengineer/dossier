// Invoice family frame (invoice, debit note, receipt): one absolutely positioned A4 page ported from the legacy
// invoice scripts (docs/DISCOVERY.md A8 §1). The templates are thin configs: `params` choose labels, columns, row
// height, the bank or acknowledgement panel and the calc rows; every printed string comes from the brand, the params
// or the values.
import { interpolate } from '../../workspace/index.js';
import { brandScope } from './document.js';
import { placeImage } from './images.js';
import { drawSignatureBlock } from './signature.js';

/**
 * Legacy geometry and the colours that are not brand palette keys. Palette keys (`ink`, `body`, `label`, `muted`,
 * `faint`, `rule`, `ruleFaint`, `fill`, `white`) resolve through the brand palette; hex values are used as given.
 * Templates override any key through `params.frame` (deep-merged).
 */
export const INVOICE_FRAME_DEFAULTS = Object.freeze({
  logo: { resizeHeight: 45, height: 26 },
  title: { font: 'ExtraBold', size: 22, color: 'ink', dy: -4 },
  meta: { dy: 26, gap: 13, size: 8.5, labelFont: 'SemiBold', labelColor: 'label', labelInset: 80, numberFont: 'Bold', dateFont: 'Medium', color: 'ink' },
  rule: { color: 'rule', width: 0.5 },
  headerRuleGap: 20,
  parties: {
    gap: 15, headingFont: 'Bold', headingSize: 9.5, headingColor: 'ink',
    nameFont: 'Bold', nameSize: 9.5, nameColor: 'body', nameDy: 15,
    addressFont: 'Regular', addressSize: 8.5, addressColor: 'label', addressGap: 3, lineGap: 1.5,
    colGap: 20, contactGap: 4, contactStep: 2, contactSize: 8, contactLabelFont: 'SemiBold', contactLabelColor: 'label',
    contactValueFont: 'Medium', contactValueColor: 'body', minHeight: 95, ruleGap: 20,
  },
  table: {
    gap: 15,
    header: { height: 22, fill: 'ink', font: 'Bold', size: 8.5, color: 'white', textDy: 7 },
    row: {
      size: 8.5, textDy: 12, minHeight: 44, fills: ['fill', 'white'],
      indexFont: 'Medium', indexColor: 'body', descriptionFont: 'Medium', descriptionColor: 'ink', descriptionPadRight: 15,
      descriptionLineGap: 1.5, descriptionLongDy: null, descriptionLongChars: 40,
      codeFont: 'Regular', codeColor: 'label', amountFont: 'Bold', amountColor: 'ink',
    },
    ruleColor: 'rule',
  },
  summary: {
    gap: 15, columnWidth: 200, panelReserve: 80,
    bank: { headingFont: 'Bold', headingSize: 9, headingColor: 'ink', linesDy: 15, size: 8, step: 2, labelFont: 'SemiBold', labelColor: 'label', valueFont: 'Medium', valueColor: 'body' },
    acknowledgement: {
      height: 80, radius: 3, stroke: '#cbd5e1', strokeWidth: 0.5, pad: 10, gapRight: 20,
      titleFont: 'Bold', titleSize: 8.5, titleColor: 'ink', textDy: 24, textFont: 'Regular', textSize: 8, textColor: '#444444', lineGap: 2.2,
    },
    calc: { rowHeight: 18, labelWidth: 100, size: 8.5, font: 'Medium', labelColor: 'label', valueColor: 'ink' },
    total: { gap: 4, dy: -4, height: 24, radius: 3, padLeft: 6, fill: 'ink', font: 'Bold', size: 9.5, color: 'white', textDy: 1 },
  },
  signature: {
    gap: 35, ruleGap: 15, width: 200, imageHeight: 45, offsets: { image: 12, name: 3, title: 12 },
    forStyle: { font: 'Bold', size: 8, color: 'label' }, nameStyle: { font: 'Bold', size: 9, color: 'ink' },
    titleStyle: { font: 'Medium', size: 8, color: 'muted' }, uppercase: true, variant: 'compact',
  },
  bottom: {
    stripInset: 10, declarationDy: -45, headingFont: 'Bold', headingSize: 8.5, headingColor: 'ink', textDy: 12,
    textFont: 'Regular', textSize: 7.5, textColor: 'muted', lineGap: 1.5, ruleDy: -8, ruleColor: 'ruleFaint',
    thankYouFont: 'Bold', thankYouSize: 8, thankYouColor: 'faint',
  },
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge for style objects (arrays and scalars replace). */
export function mergeStyle(base, over) {
  if (!isPlainObject(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? mergeStyle(base[k], v) : v;
  return out;
}

/** Round half up (away from zero) to an integer. */
const roundHalfUp = (x) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + 1e-9);

/**
 * Totals of an item list in minor units. Tax is charged on the subtotal: total tax =
 * roundHalfUp(subtotal × Σ rates); it is split over the mode's rates in proportion, every share but the last rounded
 * half down and the last taking the remainder, so the shares always add up to the total tax and an odd paisa lands on
 * the last line (CGST 17.46 / SGST 17.47 for a total tax of 34.93, as in the legacy invoices).
 * @param {Array<{ amount: number }>} items amounts in integer minor units
 * @param {{ rates?: Array<{ label: string, rate: number }> }|null} [mode] a brand tax mode (`brand.tax.modes[i]`)
 * @returns {{ subtotal: number, taxes: Array<{ label: string, rate: number, amount: number }>, taxTotal: number, total: number }}
 */
export function invoiceTotals(items, mode) {
  let subtotal = 0;
  items.forEach((it, i) => {
    if (!Number.isSafeInteger(it?.amount)) throw new Error(`item ${i + 1}: amount must be an integer number of minor units`);
    subtotal += it.amount;
  });
  const rates = mode?.rates ?? [];
  const rateSum = rates.reduce((s, r) => s + r.rate, 0);
  const taxTotal = rateSum ? roundHalfUp(subtotal * rateSum) : 0;
  let given = 0;
  const taxes = rates.map((r, i) => {
    const last = i === rates.length - 1;
    const exact = rateSum ? (taxTotal * r.rate) / rateSum : 0;
    const amount = last ? taxTotal - given : Math.sign(exact) * Math.ceil(Math.abs(exact) - 0.5 - 1e-9);
    given += amount;
    return { label: r.label, rate: r.rate, amount };
  });
  return { subtotal, taxes, taxTotal, total: subtotal + taxTotal };
}

/** Lines of an address value: a list of lines, or text with newlines. */
const addressLines = (v) => (Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : String(v).split(/\r?\n/));

/**
 * Validate a row height: a positive number of points or `'auto'` (grow to fit the description).
 * @param {unknown} v
 * @returns {number|'auto'}
 */
export function parseRowHeight(v) {
  if (v === undefined || v === null || v === '') return 'auto';
  if (v === 'auto') return 'auto';
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  throw new Error(`row height must be a positive number of points or "auto" (got ${JSON.stringify(v)})`);
}

/**
 * Everything the frame prints, resolved once from the values, params and brand; the PDF, HTML and Markdown renditions
 * all draw from it.
 *
 * Params (`template.json` `params`): `title`, `numberLabel`, `dateLabel`, `partyLabel`, `fromLabel`, `uppercaseFromName`,
 * `columns` (`[{ key, label, width, align?, default? }]`; keys `index`, `description`, `amount` or an item key; `default`
 * is interpolated with the brand, e.g. `{tax.defaultHsn}`), `rowHeight` (`number | 'auto'`), `subtotalLabel`,
 * `totalLabel`, `showBank`, `bankTitle`, `bankFields`, `bankLabels`, `acknowledgement` (`{ title, text }` or false),
 * `contactLabels`, `taxIdLabel`, `declarationTitle`, `declarationString` (brand string key), `declaration` (fallback
 * text), `thankYouString`, `signatureAlt` (HTML alt text of the signature image, `{name}` = the signatory; default
 * `Signature of {name}`), `frame` (style overrides, see INVOICE_FRAME_DEFAULTS).
 * Values: `number`, `date`, `billTo.{name,address}`, `items[{ description, amount, <column keys> }]`, `totals`
 * (from invoiceTotals), `bank`, `signatory`, `acknowledgement.{title,text}`, `rowHeight`, `descriptionWeight`, `seal`.
 * @param {Record<string, any>} values
 * @param {{ brand: object, params: object, fmt: object, meta: object, draft?: boolean }} env
 */
export function invoiceModel(values, env) {
  const { brand, fmt, meta } = env;
  const p = env.params ?? {};
  const scope = brandScope(brand, meta?.contact ?? 'default');
  const interp = (s, extra = {}) => interpolate(s, { ...scope, ...extra });
  const money = (minor) => fmt.money(minor, { space: true });
  const contactKey = meta?.contact ?? 'default';
  const contactValue = (k) => brand.contacts?.[contactKey]?.[k] ?? brand.contacts?.default?.[k];

  const taxIdLabel = p.taxIdLabel ?? 'GSTIN';
  const contactLabels = { taxId: taxIdLabel, phone: 'Phone', email: 'Email', website: 'Website', ...p.contactLabels };
  const taxId = (brand.registrations ?? []).find((r) => r.label === taxIdLabel)?.value;
  const contacts = [
    ['taxId', taxId], ['phone', contactValue('phone')], ['email', contactValue('email')], ['website', contactValue('website')],
  ].filter(([, v]) => v).map(([k, v]) => ({ label: contactLabels[k], value: v }));

  const columns = (p.columns ?? DEFAULT_COLUMNS).map((c) => ({ align: 'left', ...c }));
  const items = values.items ?? [];
  const rows = items.map((it, i) => Object.fromEntries(columns.map((c) => {
    if (c.key === 'index') return [c.key, String(i + 1)];
    if (c.key === 'amount') return [c.key, money(it.amount)];
    const v = it[c.key];
    return [c.key, v === undefined || v === null || v === '' ? interp(c.default ?? '') : String(v)];
  })));

  const totals = values.totals ?? invoiceTotals(items, null);
  const calc = [{ label: p.subtotalLabel ?? 'Subtotal', value: money(totals.subtotal), amount: totals.subtotal }];
  for (const t of totals.taxes) calc.push({ label: t.label, value: money(t.amount), amount: t.amount });

  let bank = null;
  if (p.showBank !== false && values.bank) {
    const labels = { accountName: 'Account Name', bankName: 'Bank Name', accountNumber: 'Account No', ifsc: 'IFSC Code', swift: 'SWIFT', branch: 'Branch', ...p.bankLabels };
    const fields = p.bankFields ?? ['accountName', 'bankName', 'accountNumber', 'ifsc', 'branch'];
    bank = {
      title: p.bankTitle ?? 'BANK DETAILS',
      lines: fields.filter((k) => values.bank[k]).map((k) => ({ label: labels[k] ?? k, value: String(values.bank[k]) })),
    };
  }

  let acknowledgement = null;
  if (p.acknowledgement) {
    const partyName = values.billTo?.name ?? '';
    const extra = { amount: fmt.money(totals.total), amountWords: fmt.amountInWords(Math.max(0, totals.total)), party: partyName };
    acknowledgement = {
      title: values.acknowledgement?.title ?? p.acknowledgement.title ?? '',
      text: interp(values.acknowledgement?.text ?? p.acknowledgement.text ?? '', extra),
    };
  }

  const signatory = values.signatory;
  const sigStyle = mergeStyle(INVOICE_FRAME_DEFAULTS.signature, p.frame?.signature);
  const up = (s) => (sigStyle.uppercase && s ? s.toUpperCase() : s);
  const declaration = (p.declarationString && brand.strings?.[p.declarationString] !== undefined)
    ? interp(brand.strings[p.declarationString]) : interp(p.declaration ?? '');

  return {
    title: p.title ?? 'INVOICE',
    number: { label: `${p.numberLabel ?? 'INVOICE NO'}: `, value: env.draft ? 'DRAFT' : values.number ?? '' },
    date: { label: `${p.dateLabel ?? 'DATE'}: `, value: values.date ? fmt.date(values.date, 'short') : '' },
    party: { label: p.partyLabel ?? 'BILL TO', name: values.billTo?.name ?? '', address: addressLines(values.billTo?.address) },
    from: {
      label: p.fromLabel ?? 'FROM',
      name: p.uppercaseFromName === false ? brand.legalName : brand.legalName.toUpperCase(),
      address: brand.addresses?.business ?? [],
      contacts,
    },
    columns,
    rows,
    items,
    rowHeight: parseRowHeight(values.rowHeight ?? p.rowHeight),
    descriptionFont: values.descriptionWeight ?? p.descriptionWeight ?? null,
    calc,
    total: { label: p.totalLabel ?? 'Total Invoice', value: money(totals.total), amount: totals.total },
    totals,
    bank,
    acknowledgement,
    signatory: signatory ? {
      id: signatory.id,
      forLine: up(interp(brand.strings?.forCompany ?? '')),
      name: up(signatory.name),
      title: up(signatory.title),
      seal: values.seal === true,
      alt: interp(p.signatureAlt ?? 'Signature of {name}', { name: signatory.name }),
    } : null,
    declaration: { title: p.declarationTitle ?? 'Declaration', text: declaration },
    thankYou: interp(brand.strings?.[p.thankYouString ?? 'thankYou'] ?? ''),
  };
}

/** Columns of the legacy invoice item table. */
export const DEFAULT_COLUMNS = Object.freeze([
  { key: 'index', label: 'S.NO', width: 35, padX: 8 },
  { key: 'description', label: 'DESCRIPTION', width: 275 },
  { key: 'hsn', label: 'HSN/SAC', width: 80, align: 'center', default: '{tax.defaultHsn}' },
  { key: 'amount', label: 'AMOUNT', width: 125.28, align: 'right', padX: 8 },
]);

/**
 * Draw the invoice frame on a new page of a `createPdf({ profileId: 'invoice' })` context.
 * Layout (legacy, y down from the page top): logo h26 at (ML, MT); title right at MT-4; number at MT+26, date +13; rule
 * +20; parties +15 (two columns of CW/2-10, the right one at ML+colW+20); rule at max(bottom+20, partiesY+95); table
 * +15 (header h22, rows fixed height or max(minHeight, description height + 2×textDy)); summary +15 below the table
 * (bank details or the acknowledgement panel on the left, calc rows h18 and the total pill on the right, x = PW-MR-200);
 * signatory rule at max(y after the total + 35, summaryY + panelReserve); declaration at PH-MB-10-45; thank-you strip at
 * PH-MB-10. Rows or a summary that would run into the signatory and declaration zone move to a new page, which repeats
 * the logo, title, number and date.
 * @param {import('./document.js').PdfContext} ctx
 * @param {ReturnType<typeof invoiceModel>} model
 * @param {object} [frame] style overrides (deep-merged over INVOICE_FRAME_DEFAULTS)
 * @returns {Promise<{ tableY: number, tableBottom: number, summaryY: number, footerStartY: number, declarationY: number }>}
 */
export async function drawInvoiceFrame(ctx, model, frame) {
  const { doc, profile, palette } = ctx;
  const S = mergeStyle(INVOICE_FRAME_DEFAULTS, frame);
  const col = (c) => (c === undefined || c === null ? c : palette?.[c] ?? c);
  const { ML, MR, MT, MB, PW, PH, CW } = profile;
  const rule = (y, color = S.rule.color) => doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(col(color)).lineWidth(S.rule.width).stroke();

  // Header: logo, title, number and date (repeated on continuation pages so every page identifies the document).
  const headerY = MT;
  const logo = await ctx.assets.logo({ resizeHeight: S.logo.resizeHeight });
  const m = S.meta;
  const metaRow = (y, label, value, font) => {
    doc.font(m.labelFont).fontSize(m.size).fillColor(col(m.labelColor))
      .text(label, ML, y, { align: 'right', width: CW - m.labelInset })
      .font(font).fillColor(col(m.color))
      .text(value, ML, y, { align: 'right', width: CW });
  };
  /** Add a page with the document head; returns the y of the rule under it. */
  const newPage = () => {
    doc.addPage();
    placeImage(ctx, logo, ML, headerY, { height: S.logo.height });
    doc.font(S.title.font).fontSize(S.title.size).fillColor(col(S.title.color))
      .text(model.title, ML, headerY + S.title.dy, { align: 'right', width: CW });
    const metaY = headerY + m.dy;
    metaRow(metaY, model.number.label, model.number.value, m.numberFont);
    const dateY = metaY + m.gap;
    metaRow(dateY, model.date.label, model.date.value, m.dateFont);
    const ruleY = dateY + S.headerRuleGap;
    rule(ruleY);
    return ruleY;
  };
  const headerRuleY = newPage();
  /** Top of the content on a continuation page. */
  const continueAt = () => newPage() + S.table.gap;

  // Parties.
  const P = S.parties;
  const addressY = headerRuleY + P.gap;
  const colW = CW / 2 - 10;
  doc.font(P.headingFont).fontSize(P.headingSize).fillColor(col(P.headingColor)).text(model.party.label, ML, addressY);
  doc.font(P.nameFont).fontSize(P.nameSize).fillColor(col(P.nameColor))
    .text(model.party.name, ML, addressY + P.nameDy, { width: colW, lineGap: P.lineGap });
  if (model.party.address.length) {
    doc.font(P.addressFont).fontSize(P.addressSize).fillColor(col(P.addressColor))
      .text(model.party.address.join('\n'), ML, doc.y + P.addressGap, { width: colW - 10, lineGap: P.lineGap });
  }
  const rightX = ML + colW + P.colGap;
  doc.font(P.headingFont).fontSize(P.headingSize).fillColor(col(P.headingColor)).text(model.from.label, rightX, addressY);
  doc.font(P.nameFont).fontSize(P.nameSize).fillColor(col(P.nameColor)).text(model.from.name, rightX, addressY + P.nameDy, { width: colW });
  if (model.from.address.length) {
    doc.font(P.addressFont).fontSize(P.addressSize).fillColor(col(P.addressColor))
      .text(model.from.address.join('\n'), rightX, doc.y + P.addressGap, { width: colW, lineGap: P.lineGap });
  }
  model.from.contacts.forEach((c, i) => {
    const y = i === 0 ? doc.y + P.contactGap : doc.y + P.contactStep;
    doc.font(P.contactLabelFont).fontSize(P.contactSize).fillColor(col(P.contactLabelColor))
      .text(`${c.label}: `, rightX, y, { continued: true })
      .font(P.contactValueFont).fillColor(col(P.contactValueColor))
      .text(c.value);
  });
  const partiesRuleY = Math.max(doc.y + P.ruleGap, addressY + P.minHeight);
  rule(partiesRuleY);

  // Item table.
  const T = S.table;
  const R = T.row;
  let x = ML;
  const cols = model.columns.map((c) => {
    const out = { ...c, x, w: c.width ?? 0 };
    x += out.w;
    return out;
  });
  const flex = cols.filter((c) => !c.width);
  if (flex.length) {
    const rest = (CW - cols.reduce((s, c) => s + c.w, 0)) / flex.length;
    let cx = ML;
    for (const c of cols) {
      if (!c.width) c.w = rest;
      c.x = cx;
      cx += c.w;
    }
  }
  const descFont = model.descriptionFont ?? R.descriptionFont;
  const descWidth = (c) => c.w - R.descriptionPadRight;
  const cellBox = (c) => {
    const pad = c.padX ?? 0;
    if (c.align === 'right') return { cx: c.x, width: c.w - pad };
    if (c.align === 'center') return { cx: c.x, width: c.w };
    return { cx: c.x + pad, width: c.w - pad };
  };
  const drawHeader = (y) => {
    doc.rect(ML, y, CW, T.header.height).fill(col(T.header.fill));
    doc.font(T.header.font).fontSize(T.header.size).fillColor(col(T.header.color));
    for (const c of cols) {
      const { cx, width } = cellBox(c);
      doc.text(c.label ?? '', cx, y + T.header.textDy, { width, ...(c.align !== 'left' ? { align: c.align } : {}) });
    }
    return y + T.header.height;
  };
  const descOpts = (c) => ({ width: descWidth(c), ...(R.descriptionLineGap != null ? { lineGap: R.descriptionLineGap } : {}) });
  const rowHeightOf = (row) => {
    if (model.rowHeight !== 'auto') return model.rowHeight;
    const dc = cols.find((c) => c.key === 'description');
    if (!dc) return R.minHeight;
    doc.font(descFont).fontSize(R.size);
    return Math.max(R.minHeight, doc.heightOfString(row.description ?? '', descOpts(dc)) + 2 * R.textDy);
  };

  const stripY = PH - MB - S.bottom.stripInset;
  const declY = stripY + S.bottom.declarationDy;
  const sigNeeds = S.signature.ruleGap + S.signature.offsets.image + S.signature.imageHeight + S.signature.offsets.name + S.signature.offsets.title + 12;
  const tableY = partiesRuleY + T.gap;
  let y = drawHeader(tableY);
  model.rows.forEach((row, idx) => {
    const h = rowHeightOf(row);
    if (y + h > declY - 10) {
      rule(y, T.ruleColor);
      y = drawHeader(continueAt());
    }
    const fills = R.fills ?? [];
    if (fills.length) doc.rect(ML, y, CW, h).fill(col(fills[idx % fills.length]));
    for (const c of cols) {
      const text = row[c.key] ?? '';
      let dy = R.textDy;
      if (c.key === 'index') doc.font(R.indexFont).fontSize(R.size).fillColor(col(R.indexColor));
      else if (c.key === 'description') {
        doc.font(descFont).fontSize(R.size).fillColor(col(R.descriptionColor));
        if (R.descriptionLongDy != null && text.length > R.descriptionLongChars) dy = R.descriptionLongDy;
        doc.text(text, c.x + (c.padX ?? 0), y + dy, descOpts(c));
        continue;
      } else if (c.key === 'amount') doc.font(R.amountFont).fontSize(R.size).fillColor(col(R.amountColor));
      else doc.font(R.codeFont).fontSize(R.size).fillColor(col(R.codeColor));
      const { cx, width } = cellBox(c);
      doc.text(text, cx, y + dy, { width, ...(c.align !== 'left' ? { align: c.align } : {}) });
    }
    y += h;
  });
  const tableBottom = y;
  rule(tableBottom, T.ruleColor);

  // Summary: bank details or acknowledgement on the left, calc rows and the total pill on the right.
  const SM = S.summary;
  let summaryY = tableBottom + SM.gap;
  const calcRows = model.calc.length;
  // The signatory rule goes at max(y after the total + gap, summaryY + panelReserve); y after the total is the last
  // calc row, the pill gap and the total text line.
  const calcHeight = calcRows * SM.calc.rowHeight + SM.total.gap + SM.total.textDy + doc.font(SM.total.font).fontSize(SM.total.size).currentLineHeight(true);
  const summaryNeeds = Math.max(SM.panelReserve, calcHeight + S.signature.gap) + sigNeeds;
  if (summaryY + summaryNeeds > declY) summaryY = continueAt();
  if (model.bank) {
    const B = SM.bank;
    doc.font(B.headingFont).fontSize(B.headingSize).fillColor(col(B.headingColor)).text(model.bank.title, ML, summaryY);
    model.bank.lines.forEach((l, i) => {
      const ly = i === 0 ? summaryY + B.linesDy : doc.y + B.step;
      doc.font(B.labelFont).fontSize(B.size).fillColor(col(B.labelColor))
        .text(`${l.label}: `, ML, ly, { continued: true })
        .font(B.valueFont).fillColor(col(B.valueColor))
        .text(l.value);
    });
  } else if (model.acknowledgement) {
    const A = SM.acknowledgement;
    const ackW = CW - SM.columnWidth - A.gapRight;
    doc.roundedRect(ML, summaryY, ackW, A.height, A.radius).strokeColor(col(A.stroke)).lineWidth(A.strokeWidth).stroke();
    doc.font(A.titleFont).fontSize(A.titleSize).fillColor(col(A.titleColor))
      .text(model.acknowledgement.title, ML + A.pad, summaryY + A.pad);
    doc.font(A.textFont).fontSize(A.textSize).fillColor(col(A.textColor))
      .text(model.acknowledgement.text, ML + A.pad, summaryY + A.textDy, { width: ackW - 2 * A.pad, lineGap: A.lineGap });
  }
  const calcX = PW - MR - SM.columnWidth;
  const C = SM.calc;
  let cy = summaryY;
  model.calc.forEach((r, i) => {
    if (i > 0) cy += C.rowHeight;
    doc.font(C.font).fontSize(C.size).fillColor(col(C.labelColor)).text(r.label, calcX, cy, { width: SM.columnWidth - C.labelWidth });
    doc.font(C.font).fontSize(C.size).fillColor(col(C.valueColor)).text(r.value, calcX, cy, { align: 'right', width: SM.columnWidth });
  });
  const TT = SM.total;
  cy += C.rowHeight + TT.gap;
  doc.roundedRect(calcX - TT.padLeft, cy + TT.dy, SM.columnWidth + TT.padLeft, TT.height, TT.radius).fill(col(TT.fill));
  doc.font(TT.font).fontSize(TT.size).fillColor(col(TT.color))
    .text(model.total.label, calcX, cy + TT.textDy, { width: SM.columnWidth - C.labelWidth });
  doc.text(model.total.value, calcX, cy + TT.textDy, { align: 'right', width: SM.columnWidth - TT.padLeft });

  // Signatory and the bottom strip (bottom margin 0 so nothing breaks the page).
  const G = S.signature;
  let footerStartY = Math.max(doc.y + G.gap, summaryY + SM.panelReserve);
  if (footerStartY + sigNeeds > declY) footerStartY = continueAt();
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  rule(footerStartY);
  if (model.signatory) {
    await drawSignatureBlock(ctx, {
      x: PW - MR - G.width, y: footerStartY + G.ruleGap, align: 'right', width: G.width,
      signatoryId: model.signatory.id, variant: G.variant, imageHeight: G.imageHeight, offsets: G.offsets,
      forLine: model.signatory.forLine, name: model.signatory.name, title: model.signatory.title,
      forStyle: { ...G.forStyle, color: col(G.forStyle.color) },
      nameStyle: { ...G.nameStyle, color: col(G.nameStyle.color) },
      titleStyle: { ...G.titleStyle, color: col(G.titleStyle.color) },
      seal: model.signatory.seal ? undefined : null,
    });
  }
  const Bt = S.bottom;
  if (model.declaration.text) {
    doc.font(Bt.headingFont).fontSize(Bt.headingSize).fillColor(col(Bt.headingColor)).text(model.declaration.title, ML, declY);
    doc.font(Bt.textFont).fontSize(Bt.textSize).fillColor(col(Bt.textColor))
      .text(model.declaration.text, ML, declY + Bt.textDy, { width: CW, lineGap: Bt.lineGap });
  }
  rule(stripY + Bt.ruleDy, Bt.ruleColor);
  if (model.thankYou) {
    doc.font(Bt.thankYouFont).fontSize(Bt.thankYouSize).fillColor(col(Bt.thankYouColor))
      .text(model.thankYou, ML, stripY, { align: 'center', width: CW });
  }
  doc.page.margins.bottom = savedBottom;
  return { tableY, tableBottom, summaryY, footerStartY, declarationY: declY };
}
