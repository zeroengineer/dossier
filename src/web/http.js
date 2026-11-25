// HTTP plumbing shared by the routes: error code -> status, same-origin checks, file replies, multipart bodies.
import { isDossierError } from '../errors.js';

const STATUS = {
  FORBIDDEN: 403,
  STATUS_LOCKED: 409,
  INVALID_STATUS_TRANSITION: 409,
  NUMBER_CONTENDED: 409,
  ASSET_TOO_LARGE: 413,
  CONFLICT: 409,
  TEMPLATE_RENDER_FAILED: 422,
  TEMPLATE_INVALID: 500,
  TEMPLATE_SYNTAX: 500,
};

/**
 * HTTP status of a DossierError code: `*_NOT_FOUND` 404, FORBIDDEN 403, `*_DUPLICATE`, `*CONFLICT`, STATUS_LOCKED,
 * INVALID_STATUS_TRANSITION and NUMBER_CONTENDED 409, TEMPLATE_RENDER_FAILED 422, a broken template folder 500, everything else (INVALID_INPUT,
 * FIELDS_MISSING, FIELDS_INVALID, SECRET_REJECTED, ENTITY_AMBIGUOUS, SERIES_*, NUMBER_* …) 400.
 * @param {string} code
 * @returns {number}
 */
export function statusFor(code) {
  if (Object.hasOwn(STATUS, code)) return STATUS[code];
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.endsWith('_DUPLICATE') || code.endsWith('_CONFLICT')) return 409;
  return 400;
}

/**
 * `{ status, body }` for any thrown value: DossierErrors keep their code, message and details; Fastify client errors
 * (bad JSON, too large) keep their status; anything else is a 500 without internals.
 * @param {unknown} err
 * @returns {{ status: number, body: { code: string, message: string, details: object } }}
 */
export function errorReply(err) {
  if (isDossierError(err)) return { status: statusFor(err.code), body: err.toJSON() };
  const sc = Number(err?.statusCode);
  if (sc >= 400 && sc < 500) {
    const code = sc === 413 ? 'PAYLOAD_TOO_LARGE' : sc === 404 ? 'NOT_FOUND' : sc === 403 ? 'FORBIDDEN' : sc === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_INPUT';
    return { status: sc, body: { code, message: String(err.message ?? 'Bad request'), details: {} } };
  }
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal server error', details: {} } };
}

const isLoopbackName = (h) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h);

/**
 * Hostname (without port) of a Host header value, lowercased.
 * @param {string|undefined} host
 * @returns {string}
 */
export function hostName(host) {
  const h = String(host ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

/**
 * The same-origin rule for state-changing requests (POST/PUT/PATCH/DELETE). When the browser sends `Origin` (or,
 * failing that, `Referer`), its host must equal the request's `Host`. A request with neither is accepted only when a
 * cross-site page could not have sent it without a CORS preflight (which this server never answers): a JSON body, a
 * method other than POST, or an `X-Dossier-Client` header (for scripts posting multipart uploads).
 * @param {{ method: string, headers: Record<string, string|undefined> }} req
 * @returns {string|null} null when allowed, else the reason
 */
export function crossSiteReason(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return null;
  const host = String(req.headers.host ?? '').toLowerCase();
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = origin && origin !== 'null' ? origin : referer;
  if (origin === 'null') return 'Origin "null" is not accepted';
  if (source) {
    let u;
    try { u = new URL(source); } catch { return 'Origin is not a URL'; }
    let expected;
    try { expected = new URL(`${u.protocol}//${host}`).host; } catch { return `Bad Host header ${host}`; }
    return u.host.toLowerCase() === expected ? null : `Origin ${u.host} does not match host ${host}`;
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || req.method !== 'POST' || req.headers['x-dossier-client']) return null;
  return 'A form post must carry an Origin or Referer header of this site';
}

/**
 * Whether the Host header is acceptable: any host when `allowedHosts` is null, else its hostname must be listed
 * (blocks DNS-rebinding pages from talking to a loopback server).
 * @param {string|undefined} host
 * @param {string[]|null} allowedHosts
 * @returns {boolean}
 */
export function hostAllowed(host, allowedHosts) {
  if (!allowedHosts) return true;
  const h = hostName(host);
  return allowedHosts.includes(h) || (allowedHosts.includes('localhost') && isLoopbackName(h));
}

/**
 * `Content-Disposition` value with an ASCII fallback and the UTF-8 file name (RFC 6266 / 5987).
 * @param {'inline'|'attachment'} type
 * @param {string} filename
 * @returns {string}
 */
export function contentDisposition(type, filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Cache-Control of content-addressed files a gated user may read: kept a year, never by a shared cache. */
export const CACHE_PRIVATE_IMMUTABLE = 'private, max-age=31536000, immutable';
/** Cache-Control of content-addressed files anyone may read (brand assets requested with their content hash). */
export const CACHE_PUBLIC_IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * True when an `If-None-Match` header names `etag` (a bare hash, compared as the strong tag `"<etag>"`; weak `W/`
 * tags compare by value, `*` matches anything).
 * @param {string|string[]|undefined} header
 * @param {string} etag
 * @returns {boolean}
 */
export function etagMatches(header, etag) {
  if (!header) return false;
  const want = `"${etag}"`;
  return String(header).split(',').map((t) => t.trim()).some((t) => t === '*' || t.replace(/^W\//, '') === want);
}

/**
 * Send stored bytes. PDFs are shown inline (the browser viewer); every other type gets `Content-Security-Policy:
 * sandbox` so an uploaded HTML or SVG file cannot run script with this site's origin. `download` forces an attachment.
 * With `etag` (the file's sha256) the reply carries `ETag: "<etag>"` and, when the request's `If-None-Match` names
 * it, is an empty 304. Callers check access before calling, so a 304 is only ever sent to a user who may read the
 * file. `cacheControl` defaults to `private, no-store`.
 * @param {import('fastify').FastifyReply} reply
 * @param {{ buffer: Buffer, filename: string, mime: string }} file
 * @param {{ download?: boolean, etag?: string, cacheControl?: string, req?: import('fastify').FastifyRequest }} [opts]
 */
export function sendFile(reply, { buffer, filename, mime }, { download = false, etag, cacheControl = 'private, no-store', req } = {}) {
  reply.header('Cache-Control', cacheControl);
  if (etag) {
    reply.header('ETag', `"${etag}"`);
    if (etagMatches(req?.headers['if-none-match'], etag)) return reply.code(304).send();
  }
  const type = String(mime || 'application/octet-stream');
  const textual = /^text\//.test(type) && !/charset=/i.test(type);
  reply.header('Content-Type', textual ? `${type}; charset=utf-8` : type);
  reply.header('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', filename));
  reply.header('X-Content-Type-Options', 'nosniff');
  if (type !== 'application/pdf') reply.header('Content-Security-Policy', 'sandbox');
  return reply.send(buffer);
}

/** `/api` and everything under it, in any letter case (`/API/x`, a bare `/api`). */
export const API_PATH = /^\/api(?:\/|$)/i;

/** True when the client asked for JSON (an `/api` path, or `Accept: application/json`). */
export const wantsJson = (req) => API_PATH.test(req.url.split('?')[0]) || /application\/json/.test(String(req.headers.accept ?? ''));

/**
 * Read a multipart request: the first file part (bytes, name, mime) and every text field (flat).
 * @param {import('fastify').FastifyRequest} req
 * @param {object} [opts] per-request @fastify/multipart options, e.g. `{ limits: { fileSize } }`
 * @returns {Promise<{ file: { buffer: Buffer, filename: string, mime: string }|null, fields: Record<string, string> }>}
 */
export async function readMultipart(req, opts) {
  let file = null;
  const fields = {};
  for await (const p of req.parts(opts)) {
    if (p.type === 'file') {
      const buffer = await p.toBuffer();
      if (!file && p.filename) file = { buffer, filename: p.filename, mime: p.mimetype };
    } else {
      fields[p.fieldname] = String(p.value ?? '');
    }
  }
  return { file, fields };
}
