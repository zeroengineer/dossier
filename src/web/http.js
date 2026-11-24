// HTTP plumbing shared by the routes: error code -> status, form bodies, same-origin checks, file replies.
import { isDossierError } from '../errors.js';

const STATUS = {
  FORBIDDEN: 403,
  STATUS_LOCKED: 409,
  INVALID_STATUS_TRANSITION: 409,
  NUMBER_CONTENDED: 409,
  ASSET_TOO_LARGE: 413,
  CONFLICT: 409,
  TEMPLATE_INVALID: 500,
  TEMPLATE_SYNTAX: 500,
};

/**
 * HTTP status of a DossierError code: `*_NOT_FOUND` 404, FORBIDDEN 403, `*_DUPLICATE`, `*CONFLICT`, STATUS_LOCKED,
 * INVALID_STATUS_TRANSITION and NUMBER_CONTENDED 409, a broken template folder 500, everything else (INVALID_INPUT,
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
    const code = sc === 413 ? 'PAYLOAD_TOO_LARGE' : sc === 404 ? 'NOT_FOUND' : sc === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_INPUT';
    return { status: sc, body: { code, message: String(err.message ?? 'Bad request'), details: {} } };
  }
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal server error', details: {} } };
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Turn flat form keys into nested objects: `billTo.name` -> `{ billTo: { name } }`, `items.0.amount` ->
 * `{ items: [{ amount }] }`. Prototype-reaching segments are dropped. Array holes are removed.
 * @param {Record<string, string>} flat
 * @returns {Record<string, unknown>}
 */
export function nestForm(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const segs = key.split('.');
    if (segs.some((s) => s === '' || FORBIDDEN_SEGMENTS.has(s))) continue;
    let node = out;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const last = i === segs.length - 1;
      if (last) {
        if (node[s] === undefined || typeof node[s] !== 'object') node[s] = value;
        break;
      }
      if (node[s] === undefined || typeof node[s] !== 'object' || node[s] === null) node[s] = /^\d+$/.test(segs[i + 1]) ? [] : {};
      node = node[s];
    }
  }
  const compact = (v) => {
    if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(compact);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x)]));
    return v;
  };
  return compact(out);
}

/**
 * Parse an `application/x-www-form-urlencoded` body into a flat object; a repeated key keeps the last value.
 * @param {string} body
 * @returns {Record<string, string>}
 */
export function parseUrlEncoded(body) {
  const out = Object.create(null);
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return { ...out };
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

/**
 * Send stored bytes. PDFs are shown inline (the browser viewer); every other type gets `Content-Security-Policy:
 * sandbox` so an uploaded HTML or SVG file cannot run script with this site's origin. `download` forces an attachment.
 * @param {import('fastify').FastifyReply} reply
 * @param {{ buffer: Buffer, filename: string, mime: string }} file
 * @param {{ download?: boolean }} [opts]
 */
export function sendFile(reply, { buffer, filename, mime }, { download = false } = {}) {
  const type = String(mime || 'application/octet-stream');
  const textual = /^text\//.test(type) && !/charset=/i.test(type);
  reply.header('Content-Type', textual ? `${type}; charset=utf-8` : type);
  reply.header('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', filename));
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cache-Control', 'private, no-store');
  if (type !== 'application/pdf') reply.header('Content-Security-Policy', 'sandbox');
  return reply.send(buffer);
}

/** True when the client asked for JSON (API routes, or `Accept: application/json`). */
export const wantsJson = (req) => req.url.startsWith('/api/') || /application\/json/.test(String(req.headers.accept ?? ''));

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

/**
 * Send a rendered page.
 * @param {import('fastify').FastifyReply} reply
 * @param {{ toString(): string }} body
 * @param {number} [status]
 */
export function sendPage(reply, body, status = 200) {
  return reply.code(status).type('text/html; charset=utf-8').send(String(body));
}

/** Layout extras for every page: the acting user and the workspace name. */
export const shellOf = (ctx) => ({ user: ctx.user, workspace: ctx.ws.config.name });

/** Redirect after a successful form post (303: the browser follows with GET). */
export const seeOther = (reply, url) => reply.code(303).header('Location', url).send();

/** A body field as a trimmed string ('' when absent). */
export const field = (body, key) => (body && typeof body[key] === 'string' ? body[key].trim() : '');
