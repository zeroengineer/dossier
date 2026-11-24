// Geometry extraction for PDF tests: every text item with its page, position (y from the page top), size and font.

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc ||= import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return pdfjs;
  });
  return pdfjsPromise;
}

const round = (v) => Math.round(v * 2) / 2;

/**
 * Extract text items from a PDF, measured from the top-left of the page in points and rounded to 0.5:
 * `x` the left edge, `y` the top of the line box (baseline minus the font ascent, which is the `y` that was passed to
 * pdfkit's `doc.text`), `baseline` the baseline, `size` the font size, `width` the advance width, `font` the
 * PostScript name with the subset prefix (`ABCDEF+`) removed. pdfjs merges adjacent runs of one font on one line into
 * one item (with spaces), so a justified line comes back as a few items, not one per word. Whitespace-only items are
 * dropped.
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<Array<{ page: number, text: string, x: number, y: number, baseline: number, size: number, font: string,
 *   width: number }>>}
 */
export async function extractItems(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    fontExtraProperties: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  const out = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const [, , , pageTop] = page.view;
      // The operator list loads the fonts into commonObjs, which is where their PostScript names live.
      await page.getOperatorList();
      const content = await page.getTextContent();
      const fontNames = new Map();
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        if (!fontNames.has(item.fontName)) {
          const name = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName).name : item.fontName;
          fontNames.set(item.fontName, String(name).replace(/^[A-Z]{6}\+/, ''));
        }
        const [a, b, , , e, f] = item.transform;
        const size = Math.hypot(a, b);
        const ascent = content.styles[item.fontName]?.ascent ?? 0;
        out.push({
          page: p,
          text: item.str,
          x: round(e),
          y: round(pageTop - f - ascent * size),
          baseline: round(pageTop - f),
          size: round(size),
          font: fontNames.get(item.fontName),
          width: round(item.width),
        });
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * Placed images per page: the axis-aligned box of each painted image XObject, from the top-left of the page in points
 * (rounded to 0.5). For an unrotated image `width / height` is the drawn aspect ratio.
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<Array<{ page: number, x: number, y: number, width: number, height: number }>>}
 */
export async function extractImages(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  const doc = await task.promise;
  const out = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const [, , , pageTop] = page.view;
      const { fnArray, argsArray } = await page.getOperatorList();
      const stack = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      fnArray.forEach((fn, i) => {
        if (fn === pdfjs.OPS.save) stack.push(ctm);
        else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, argsArray[i]);
        else if (fn === pdfjs.OPS.paintImageXObject) {
          const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
          const xs = pts.map((q) => q[0]);
          const ys = pts.map((q) => q[1]);
          out.push({
            page: p,
            x: round(Math.min(...xs)),
            y: round(pageTop - Math.max(...ys)),
            width: round(Math.max(...xs) - Math.min(...xs)),
            height: round(Math.max(...ys) - Math.min(...ys)),
          });
        }
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}
