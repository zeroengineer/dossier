import { extname } from 'node:path';
import { DossierError } from '../errors.js';
import { secretReason } from '../domain/secrets.js';
import { extractText } from '../extract/index.js';
import { storeBlobFile } from './blobs.js';
import { addVersion, createDocument, getDocument } from './documents.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);

/** File extension -> the typed rendition kind stored next to `original`. */
const EXT_RENDITION = { '.pdf': 'pdf', '.html': 'html', '.htm': 'html', '.md': 'md', '.markdown': 'md' };

/** File extension -> mime used when the caller gives none (or a generic one). */
const EXT_MIME = {
  '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html', '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const GENERIC_MIME = 'application/octet-stream';

/** Keys of `meta` that steer the upload itself rather than describe the document. */
const VERSION_KEYS = ['note', 'makeCurrent'];

/**
 * Upload one file into the vault. Without `meta.documentId` a document is created from `meta` (createDocument
 * fields; `title` defaults to the file name without its extension); with it, the file becomes a new version of that
 * document (only `note` and `makeCurrent` may accompany it). The version's renditions are `original` plus a
 * `pdf`/`html`/`md` rendition when the extension matches, all backed by one content-addressed blob. Text is extracted
 * (src/extract) and stored once in `document_text` against the `original` rendition. Files that look like secrets
 * (by name, bytes or extracted text) are refused with SECRET_REJECTED before anything is stored. A document number
 * already used in its series is accepted and reported as `warnings: ['NUMBER_CONFLICT']`.
 * Document creation and the version are one transaction: a failure leaves no half-made document behind.
 * @param {object} ctx
 * @param {{ buffer: Buffer|Uint8Array, filename: string, mime?: string|null,
 *   meta?: { documentId?: string, note?: string, makeCurrent?: boolean } & Record<string, unknown> }} file
 * @returns {Promise<{ document: object, version: import('./documentQueries.js').VersionView, deduped: boolean,
 *   warnings: string[] }>} `deduped` is true when a blob with the same sha256 was already stored
 */
export async function uploadFile(ctx, { buffer, filename, mime = null, meta = {} } = {}) {
  if (!(buffer instanceof Uint8Array)) throw invalid('An upload needs the file bytes as a Buffer');
  if (typeof filename !== 'string' || baseName(filename) === '') throw invalid('An upload needs a file name', { filename });
  if (mime !== null && mime !== undefined && (typeof mime !== 'string' || mime.trim() === '')) throw invalid('mime must be a string', { mime });
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw invalid('meta must be an object');

  const name = baseName(filename);
  const ext = extname(name).toLowerCase();
  const fileMime = mime && mime.trim() !== GENERIC_MIME ? mime.trim() : (EXT_MIME[ext] ?? mime?.trim() ?? GENERIC_MIME);
  const { documentId, note, makeCurrent, ...docMeta } = meta;
  if (documentId !== undefined) {
    const extra = Object.keys(docMeta);
    if (extra.length) throw invalid(`With documentId only ${VERSION_KEYS.join(' and ')} may be given (got "${extra[0]}")`, { field: extra[0] });
  }

  // Refuse secrets by name and bytes before spending time on extraction, then again on the extracted text.
  checkSecret(name, buffer, null);
  const { text, pageCount } = await extractText(buffer, { mime: fileMime, filename: name });
  checkSecret(name, buffer, text);

  const renditions = [{ kind: 'original', buffer, filename: name, mime: fileMime, pageCount, extractedText: text || undefined }];
  const typed = EXT_RENDITION[ext];
  if (typed) renditions.push({ kind: typed, buffer, filename: name, mime: EXT_MIME[ext], pageCount });

  // Blob file IO stays outside the transaction (addVersion then finds the file already present).
  const { sha256 } = storeBlobFile(ctx, buffer);
  const spec = {
    renditions: renditions.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))),
    ...(note !== undefined ? { note } : {}),
    ...(makeCurrent !== undefined ? { makeCurrent } : {}),
  };

  const { id, version, deduped } = ctx.repo.tx(() => {
    const existed = Boolean(ctx.db.prepare('SELECT 1 FROM blobs WHERE sha256 = ?').get(sha256));
    const docId = documentId !== undefined
      ? documentId
      : createDocument(ctx, { ...docMeta, title: docMeta.title ?? defaultTitle(name) }).id;
    return { id: docId, version: addVersion(ctx, docId, spec), deduped: existed };
  });
  const document = getDocument(ctx, id);
  return { document, version, deduped, warnings: document.numberConflict ? ['NUMBER_CONFLICT'] : [] };
}

/** Last path segment of a client-supplied file name (either separator), trimmed. */
function baseName(filename) {
  return String(filename).split(/[\\/]/).pop().trim();
}

function defaultTitle(name) {
  const ext = extname(name);
  return (ext && ext !== name ? name.slice(0, -ext.length) : name).trim() || name;
}

function checkSecret(filename, buffer, text) {
  const reason = secretReason({ filename, buffer, text });
  if (reason) {
    throw new DossierError('SECRET_REJECTED',
      `"${filename}" looks like a key or credential (${reason}). Keep secrets in a password manager, not the vault.`,
      { filename, reason });
  }
}
