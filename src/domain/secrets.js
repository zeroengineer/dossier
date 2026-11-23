import { basename, extname } from 'node:path';

/** File extensions that hold keys or credentials and never belong in the vault (rule B5.9). */
export const SECRET_EXTENSIONS = Object.freeze(['.pem', '.key', '.env']);

/** Byte patterns that mark key material inside any file. */
export const SECRET_MARKERS = Object.freeze(['-----BEGIN', 'PRIVATE KEY']);

/**
 * Why a file looks like a secret, or null when it does not. Checks the file name (`.pem`, `.key`, `.env`, `.env.*`),
 * the raw bytes and any extracted text for PEM armour or "PRIVATE KEY".
 * @param {{ filename?: string|null, buffer?: Buffer|Uint8Array|null, text?: string|null }} file
 * @returns {string|null}
 */
export function secretReason({ filename, buffer, text }) {
  const name = basename(String(filename ?? '')).toLowerCase();
  const ext = extname(name);
  if (SECRET_EXTENSIONS.includes(ext)) return `file extension ${ext}`;
  if (name === '.env' || name.startsWith('.env.')) return 'environment file';
  const bytes = buffer ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength) : null;
  for (const marker of SECRET_MARKERS) {
    if (bytes?.includes(marker, 0, 'latin1') || (typeof text === 'string' && text.includes(marker))) return `content contains "${marker}"`;
  }
  return null;
}
