import { extname } from 'node:path';

/** Kind of text source a file is, from its mime type first and its extension second. */
const MIME_KIND = {
  'application/pdf': 'pdf',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
  'text/plain': 'text',
};
const EXT_KIND = { '.pdf': 'pdf', '.html': 'html', '.htm': 'html', '.xhtml': 'html', '.md': 'text', '.markdown': 'text', '.txt': 'text' };

/**
 * Which extractor applies to a file: 'pdf', 'html', 'text' or null (unknown type).
 * @param {{ mime?: string|null, filename?: string|null }} file
 * @returns {'pdf'|'html'|'text'|null}
 */
export function sourceKind({ mime, filename } = {}) {
  const m = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
  return MIME_KIND[m] ?? EXT_KIND[extname(String(filename ?? '')).toLowerCase()] ?? null;
}

/**
 * Extract searchable text from an uploaded file. PDF via the pdfjs-dist legacy build (page text items joined, pages
 * separated by a blank line), HTML with tags/scripts/styles stripped and entities decoded, Markdown and plain text
 * as is. Unknown types, and encrypted or broken PDFs, give empty text; this function never throws on bad input.
 * @param {Buffer|Uint8Array} buffer
 * @param {{ mime?: string|null, filename?: string|null }} [file]
 * @returns {Promise<{ text: string, pageCount?: number }>}
 */
export async function extractText(buffer, file = {}) {
  const kind = sourceKind(file);
  if (!(buffer instanceof Uint8Array) || buffer.byteLength === 0) return { text: '' };
  if (kind === 'pdf') return pdfText(buffer);
  if (kind === 'html') return { text: htmlToText(utf8(buffer)) };
  if (kind === 'text') return { text: utf8(buffer) };
  return { text: '' };
}

const utf8 = (buffer) => Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString('utf8').replace(/^﻿/, '');

// ---------- PDF ----------

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc ||= import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return pdfjs;
  });
  return pdfjsPromise;
}

async function pdfText(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    // pdfjs takes ownership of (and may detach) the array it is given, so hand it a copy.
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('').trim());
      page.cleanup();
    }
    return { text: pages.join('\n\n'), pageCount: doc.numPages };
  } catch {
    return { text: '' };
  } finally {
    await task.destroy().catch(() => {});
  }
}

// ---------- HTML ----------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', middot: '·', deg: '°', times: '×', divide: '÷', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', para: '¶', laquo: '«', raquo: '»', shy: '',
};

const BLOCK_TAGS = 'address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/**
 * Plain text of an HTML document: comments, `<script>`, `<style>`, `<head>`-only elements and tags removed, block
 * elements turned into line breaks, entities decoded, whitespace collapsed (at most one blank line in a row).
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  const stripped = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|title|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!doctype[^>]*>/gi, ' ')
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(stripped.replace(/[ \t\f\v\r]+/g, ' '))
    .replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/ {2,}/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
