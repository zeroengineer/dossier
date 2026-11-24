// Rich text: `**bold**` runs, manual justification, bullets, headers (legacy offer-letter script (docs/DISCOVERY.md A8 §2):
// tokenize/groupTokens/renderParagraph/richText/richBullets/sectionHeader/clauseHeader/divider; MoU amount emphasis
// from the legacy v2 MoU script (docs/DISCOVERY.md A8 §12)). Defaults are the offer-letter values; every one can be overridden.

/** Paragraph defaults (offer letter). Colours default to the brand palette (`body`, `ink`). */
export const PARAGRAPH_DEFAULTS = Object.freeze({
  fontSize: 10.5, lineGap: 4.5, align: 'justify', moveDown: 0.65,
  regularFont: 'BodyRegular', boldFont: 'BodyBold',
});

/** MoU-style emphasis for words starting with the currency symbol (`amountEmphasis: true` uses these). */
export const AMOUNT_EMPHASIS_DEFAULTS = Object.freeze({ font: 'ExtraBold', sizeDelta: 0.5, dy: -0.3 });

/**
 * Split text into word runs and single-character space/newline tokens; `**` toggles bold.
 * With `amountPrefix`, a word starting with it is marked `isAmount` (and bold).
 * @param {string} text
 * @param {{ amountPrefix?: string }} [opts]
 * @returns {Array<{ text: string, isBold?: boolean, isAmount?: boolean, isSpace?: boolean }>}
 */
export function tokenize(text, { amountPrefix } = {}) {
  const tokens = [];
  let i = 0;
  let isBold = false;
  let currentWord = '';
  const push = () => {
    if (currentWord === '') return;
    if (amountPrefix) {
      const isAmount = currentWord.trim().startsWith(amountPrefix);
      tokens.push({ text: currentWord, isBold: isBold || isAmount, isAmount });
    } else {
      tokens.push({ text: currentWord, isBold });
    }
    currentWord = '';
  };
  while (i < text.length) {
    if (text.substr(i, 2) === '**') {
      push();
      isBold = !isBold;
      i += 2;
    } else if (text[i] === ' ' || text[i] === '\n') {
      push();
      tokens.push({ text: text[i], isSpace: true });
      i++;
    } else {
      currentWord += text[i];
      i++;
    }
  }
  push();
  return tokens;
}

function paragraphOptions(ctx, options) {
  const o = { ...PARAGRAPH_DEFAULTS, ...stripUndefined(options) };
  o.fillColor ??= ctx.palette.body;
  o.boldColor ??= o.fillColor;
  if (o.amountEmphasis) {
    o.amount = { ...AMOUNT_EMPHASIS_DEFAULTS, ...(o.amountEmphasis === true ? {} : o.amountEmphasis) };
    o.amount.color ??= ctx.palette.ink;
    o.amount.prefix ??= ctx.ws?.config?.locale?.currencySymbol ?? '₹';
  }
  return o;
}

function stripUndefined(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function runStyle(run, o) {
  if (run.isAmount && o.amount) {
    return { font: o.amount.font, size: o.fontSize + o.amount.sizeDelta, color: o.amount.color, dy: o.amount.dy };
  }
  return { font: run.isBold ? o.boldFont : o.regularFont, size: o.fontSize, color: run.isBold ? o.boldColor : o.fillColor, dy: 0 };
}

function groupTokens(doc, tokens, o) {
  const items = [];
  let currentRuns = [];
  const commitWord = () => {
    if (currentRuns.length === 0) return;
    let totalWidth = 0;
    for (const run of currentRuns) {
      const s = runStyle(run, o);
      doc.font(s.font).fontSize(s.size);
      totalWidth += doc.widthOfString(run.text);
    }
    items.push({ type: 'word', runs: currentRuns, width: totalWidth });
    currentRuns = [];
  };
  for (const token of tokens) {
    if (token.isSpace) {
      commitWord();
      if (token.text === '\n') items.push({ type: 'newline' });
    } else {
      currentRuns.push(token);
    }
  }
  commitWord();
  return items;
}

/**
 * Break a paragraph into lines without drawing it.
 * @param {import('./document.js').PdfContext} ctx
 * @param {string} text @param {number} width @param {object} [options] same as renderParagraph
 * @returns {{ lines: Array<{ words: Array<{ runs: object[], width: number }>, justify: boolean }>, lh: number, spaceW: number }}
 */
export function layoutParagraph(ctx, text, width, options = {}) {
  const { doc } = ctx;
  const o = options._resolved ? options : paragraphOptions(ctx, options);
  const tokens = tokenize(text, { amountPrefix: o.amount?.prefix });
  const items = groupTokens(doc, tokens, o);

  doc.font(o.regularFont).fontSize(o.fontSize);
  const lh = doc.currentLineHeight(true) + o.lineGap;
  const spaceW = doc.widthOfString(' ');

  const lines = [];
  let currentLineWords = [];
  let currentLineWidth = 0;
  for (const item of items) {
    if (item.type === 'newline') {
      if (currentLineWords.length > 0) {
        lines.push({ words: currentLineWords, justify: false });
        currentLineWords = [];
        currentLineWidth = 0;
      }
    } else {
      const wordW = item.width;
      const potentialWidth = currentLineWidth + wordW + (currentLineWords.length * spaceW);
      if (potentialWidth > width && currentLineWords.length > 0) {
        const blocked = o.noJustifyUnderscores && currentLineWords.some((w) => w.runs.some((r) => r.text.includes('__')));
        lines.push({ words: currentLineWords, justify: o.align === 'justify' && !blocked });
        currentLineWords = [item];
        currentLineWidth = wordW;
      } else {
        currentLineWords.push(item);
        currentLineWidth += wordW;
      }
    }
  }
  if (currentLineWords.length > 0) lines.push({ words: currentLineWords, justify: false });
  return { lines, lh, spaceW };
}

/**
 * Draw a paragraph at (startX, doc.y) with manual line layout. Justified lines (all but the last of each `\n` block)
 * spread `(width - Σwords) / (n - 1)` between words; `**bold**` switches font; a page is added when a line does not fit.
 * @param {import('./document.js').PdfContext} ctx
 * @param {string} text
 * @param {number} startX
 * @param {number} width
 * @param {{ fontSize?: number, lineGap?: number, fillColor?: string, boldColor?: string, align?: 'justify'|'left'|'center',
 *   moveDown?: number, regularFont?: string, boldFont?: string, maxSpaceRatio?: number, noJustifyUnderscores?: boolean,
 *   breakPad?: number, amountEmphasis?: boolean|{ font?: string, sizeDelta?: number, dy?: number, color?: string, prefix?: string } }} [options]
 *   `maxSpaceRatio` (MoU: 2.2) keeps normal spacing when the justified gap would exceed that many spaces.
 *   `breakPad` (internship offer: 5) adds that many points to the space a line needs before a page break.
 * @returns {{ lines: number }}
 */
export function renderParagraph(ctx, text, startX, width, options = {}) {
  const { doc } = ctx;
  const o = paragraphOptions(ctx, options);
  o._resolved = true;
  const { lines, lh, spaceW } = layoutParagraph(ctx, text, width, o);

  for (const line of lines) {
    if (needsBreak(ctx, lh + (o.breakPad ?? 0))) doc.addPage();
    let curX = startX;
    const justify = line.justify && line.words.length > 1;
    let spaceWidth = spaceW;
    if (justify) {
      let totalWordWidth = 0;
      for (const w of line.words) totalWordWidth += w.width;
      const calc = (width - totalWordWidth) / (line.words.length - 1);
      spaceWidth = o.maxSpaceRatio && calc > spaceW * o.maxSpaceRatio ? spaceW : calc;
    } else if (o.align === 'center') {
      let totalWordWidth = 0;
      for (const w of line.words) totalWordWidth += w.width;
      curX = startX + (width - (totalWordWidth + (line.words.length - 1) * spaceW)) / 2;
    }
    const lineY = doc.y;
    for (const word of line.words) {
      let runX = curX;
      for (const run of word.runs) {
        const s = runStyle(run, o);
        doc.font(s.font).fontSize(s.size).fillColor(s.color);
        doc.text(run.text, runX, lineY + s.dy, { lineBreak: false });
        runX += doc.widthOfString(run.text);
      }
      curX += word.width + spaceWidth;
    }
    doc.y = lineY + lh;
  }
  doc.moveDown(o.moveDown);
  return { lines: lines.length };
}

/**
 * Full-width paragraph at the left margin.
 * @param {import('./document.js').PdfContext} ctx @param {string} text @param {object} [options] see renderParagraph
 */
export function richText(ctx, text, options = {}) {
  return renderParagraph(ctx, text, options.x ?? ctx.profile.ML, options.width ?? ctx.profile.CW, options);
}

/** Bullet list defaults (offer letter). */
export const BULLET_DEFAULTS = Object.freeze({
  bullet: '•', bulletSize: 10.5, bulletX: 5, indent: 14, bulletFont: 'BodyRegular', breakMin: 25, itemMoveDown: 0.35, moveDown: 0.45,
});

/**
 * Bulleted list: `•` at `ML + bulletX`, text at `ML + bulletX + indent`, each item a rich paragraph.
 * @param {import('./document.js').PdfContext} ctx
 * @param {string[]} items
 * @param {Partial<typeof BULLET_DEFAULTS> & { bulletColor?: string, keepTogether?: boolean } & object} [options]
 *   paragraph options apply to the item text. `keepTogether` (MoU) breaks before an item that does not fit whole.
 */
export function richBullets(ctx, items, options = {}) {
  const { doc, profile } = ctx;
  const o = { ...BULLET_DEFAULTS, ...stripUndefined(options) };
  const p = paragraphOptions(ctx, { ...options, moveDown: o.itemMoveDown });
  p._resolved = true;
  const x = profile.ML + o.bulletX;
  const width = profile.CW - o.bulletX - o.indent;
  for (const item of items) {
    if (o.keepTogether) {
      const { lines, lh } = layoutParagraph(ctx, item, width, p);
      if (needsBreak(ctx, lines.length * lh + 4)) doc.addPage();
    } else if (needsBreak(ctx, o.breakMin)) {
      doc.addPage();
    }
    const startY = doc.y;
    doc.font(o.bulletFont).fontSize(o.bulletSize).fillColor(o.bulletColor ?? p.fillColor)
      .text(o.bullet, x, startY, { width: o.indent, lineBreak: false });
    doc.y = startY;
    renderParagraph(ctx, item, x + o.indent, width, p);
  }
  doc.moveDown(o.moveDown);
}

/**
 * True when the cursor is within `minSpace` of the content bottom (`PH - MB - CP`).
 * @param {import('./document.js').PdfContext} ctx @param {number} minSpace
 */
export function needsBreak(ctx, minSpace) {
  const { PH, MB, CP } = ctx.profile;
  return ctx.doc.y > PH - MB - (CP ?? 0) - minSpace;
}

function heading(ctx, text, d, options) {
  const { doc, profile, palette } = ctx;
  const o = { ...d, ...stripUndefined(options) };
  if (needsBreak(ctx, o.breakMin)) doc.addPage();
  doc.moveDown(o.before);
  doc.font(o.font).fontSize(o.size).fillColor(o.color ?? palette.ink)
    .text(o.uppercase ? text.toUpperCase() : text, o.x ?? profile.ML, doc.y,
      { width: o.width ?? profile.CW, lineGap: o.lineGap, ...(o.align ? { align: o.align } : {}) });
  doc.moveDown(o.after);
}

/** Section header defaults (offer letter). */
export const SECTION_DEFAULTS = Object.freeze({ font: 'BodyBold', size: 17, lineGap: 2, before: 0.5, after: 0.65, breakMin: 60, uppercase: true });
/** Clause header defaults (offer letter). */
export const CLAUSE_DEFAULTS = Object.freeze({ font: 'BodyBold', size: 12, lineGap: 1.5, before: 0.35, after: 0.45, breakMin: 90, uppercase: false });

/**
 * Section header: page break when fewer than `breakMin` points remain, moveDown `before`, text, moveDown `after`.
 * @param {import('./document.js').PdfContext} ctx @param {string} text
 * @param {Partial<typeof SECTION_DEFAULTS> & { color?: string, x?: number, width?: number, align?: string }} [options]
 */
export function sectionHeader(ctx, text, options = {}) {
  heading(ctx, text, SECTION_DEFAULTS, options);
}

/**
 * Clause header (numbered clause title).
 * @param {import('./document.js').PdfContext} ctx @param {string} text
 * @param {Partial<typeof CLAUSE_DEFAULTS> & { color?: string, x?: number, width?: number, align?: string }} [options]
 */
export function clauseHeader(ctx, text, options = {}) {
  heading(ctx, text, CLAUSE_DEFAULTS, options);
}

/** Divider defaults (offer letter); proposals use `{ breakMin: 110, onBreak: 'skip', before: 0.6, after: 0.6 }`. */
export const DIVIDER_DEFAULTS = Object.freeze({ breakMin: 20, onBreak: 'page', before: 0.5, after: 0.65, lineWidth: 0.4 });

/**
 * Full-width hairline. Near the page bottom it either starts a new page (`onBreak: 'page'`) or is skipped (`'skip'`).
 * @param {import('./document.js').PdfContext} ctx
 * @param {Partial<typeof DIVIDER_DEFAULTS> & { color?: string }} [options]
 */
export function divider(ctx, options = {}) {
  const { doc, profile, palette } = ctx;
  const o = { ...DIVIDER_DEFAULTS, ...stripUndefined(options) };
  if (needsBreak(ctx, o.breakMin)) {
    if (o.onBreak === 'skip') return;
    doc.addPage();
  }
  doc.moveDown(o.before);
  doc.moveTo(profile.ML, doc.y).lineTo(profile.PW - profile.MR, doc.y)
    .strokeColor(o.color ?? palette.rule).lineWidth(o.lineWidth).stroke();
  doc.moveDown(o.after);
}
