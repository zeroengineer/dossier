import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DossierError } from '../errors.js';

const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * Path of a blob relative to the data directory: `blobs/<sha[0..2]>/<sha>` (the value of `blobs.stored_path`).
 * @param {string} sha
 * @returns {string}
 */
export function blobRelPath(sha) {
  checkSha(sha);
  return `blobs/${sha.slice(0, 2)}/${sha}`;
}

/**
 * Absolute path of a blob file under `<dataDir>/blobs`.
 * INTERNAL: performs no access check (one blob can back documents of different sensitivity). Not for request
 * handlers; serve files through documentQueries.readRendition.
 * @param {{ config: { dataDir: string } }} ctx
 * @param {string} sha lowercase hex sha256
 * @returns {string}
 */
export const blobPath = (ctx, sha) => join(ctx.config.dataDir, blobRelPath(sha));

/**
 * sha256 of a buffer as lowercase hex.
 * @param {Buffer|Uint8Array} buffer
 * @returns {string}
 */
export const sha256Of = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Write bytes to the content-addressed store without touching the database: temp file + rename, skipped when a
 * file for that sha256 already exists (a missing file is rewritten, so the store heals itself). Safe to call
 * outside a transaction: an unreferenced file is harmless and is reused by the next identical upload.
 * @param {object} ctx
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ sha256: string, bytes: number }}
 */
export function storeBlobFile(ctx, buffer) {
  if (!(buffer instanceof Uint8Array)) throw new DossierError('INVALID_INPUT', 'A blob needs a Buffer', {});
  const sha256 = sha256Of(buffer);
  const file = blobPath(ctx, sha256);
  if (!existsSync(file)) writeAtomic(file, buffer);
  return { sha256, bytes: buffer.byteLength };
}

/**
 * Insert the `blobs` row for a file already written by storeBlobFile (audited as `blob.put`), or return the existing
 * row. Joins the caller's transaction.
 * @param {object} ctx
 * @param {{ sha256: string, bytes: number, mime?: string|null }} blob
 * @returns {{ sha256: string, bytes: number, created: boolean }}
 */
export function recordBlob(ctx, { sha256, bytes, mime = null }) {
  return ctx.repo.tx(() => {
    const existing = ctx.db.prepare('SELECT bytes FROM blobs WHERE sha256 = ?').get(sha256);
    if (existing) return { sha256, bytes: existing.bytes, created: false };
    const row = { sha256, bytes, mime: mime ?? null, stored_path: blobRelPath(sha256) };
    ctx.db.prepare('INSERT INTO blobs (sha256, bytes, mime, stored_path) VALUES (?, ?, ?, ?)').run(sha256, bytes, row.mime, row.stored_path);
    ctx.repo.audit('blob.put', 'blob', sha256, null, row);
    ctx.repo.bump('blobs');
    return { sha256, bytes, created: true };
  });
}

/**
 * Store bytes content-addressed (rule B5.4): storeBlobFile, then recordBlob. A repeat upload of identical bytes
 * returns the existing row with `created: false`.
 * @param {object} ctx
 * @param {Buffer|Uint8Array} buffer
 * @param {{ mime?: string|null }} [opts] stored on first sight only
 * @returns {{ sha256: string, bytes: number, created: boolean }}
 */
export function putBlob(ctx, buffer, { mime = null } = {}) {
  return recordBlob(ctx, { ...storeBlobFile(ctx, buffer), mime });
}

/**
 * Read a stored blob's bytes.
 * INTERNAL: performs no access check (one blob can back documents of different sensitivity). Not for request
 * handlers; serve files through documentQueries.readRendition.
 * @param {object} ctx
 * @param {string} sha
 * @returns {Buffer} throws BLOB_NOT_FOUND when the file is missing
 */
export function readBlob(ctx, sha) {
  const file = blobPath(ctx, sha);
  try {
    return readFileSync(file);
  } catch (err) {
    if (err?.code === 'ENOENT') throw new DossierError('BLOB_NOT_FOUND', `No stored file for blob ${sha}`, { sha256: sha });
    throw err;
  }
}

function checkSha(sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new DossierError('INVALID_INPUT', 'A blob id is a lowercase hex sha256', { sha256: sha });
}

function writeAtomic(file, buffer) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, buffer, { flag: 'wx' });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
