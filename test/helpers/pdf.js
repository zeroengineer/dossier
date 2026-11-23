import { createRequire } from 'node:module';

const PDFDocument = createRequire(import.meta.url)('pdfkit');

/**
 * Build a small PDF in memory with pdfkit, one string per page.
 * @param {string[]} pages
 * @param {object} [options] extra PDFDocument options (e.g. `userPassword` for an encrypted file)
 * @returns {Promise<Buffer>}
 */
export function makePdf(pages, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, compress: false, info: { CreationDate: new Date(0) }, ...options });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const p of pages) doc.addPage().font('Helvetica').fontSize(12).text(p, 72, 72);
    doc.end();
  });
}
