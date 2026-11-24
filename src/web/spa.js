// Serving the built web app (web/dist): static files, and index.html as the fallback for client-side routes.
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import { CACHE_PUBLIC_IMMUTABLE, wantsJson } from './http.js';

/** Content-Security-Policy of the web app's HTML (Radix and Recharts set inline styles; Vite emits no inline scripts). */
export const SPA_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
  + "font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

/** Paths that name files (bundle, backend files, renditions); a miss there is a real 404, never the web app. */
const FILE_NAMESPACE = /^\/(?:(?:app|assets|blobs|previews|brand|static)\/|documents\/[^/]+\/renditions(?:\/|$)|favicon\.ico$)/;

/** A last path segment that names a file (`/workspace.json`, `/robots.txt`): a miss is a 404, not a client route. */
const FILE_EXTENSION = /\.(?:json|m?js|css|map|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|pdf|html?|md|ttf|otf|woff2?|webmanifest|db|sqlite)$/i;

/**
 * Interim (until F21): the server-rendered pages own these paths, so a miss under them keeps the old 404 page.
 * F21 deletes the old pages and this list.
 */
const OLD_UI = /^\/(?:search|upload|generate|templates|entities|settings)(?:\/|$)/;

const NOT_BUILT = '<!doctype html><title>Dossier</title><p>The web app is not built: run <code>npm run build</code> and restart the server.</p>\n';

/**
 * True when an unmatched request should get the web app's index.html: GET/HEAD, not `/api/*`, not JSON-accepting, not
 * under a file namespace, not a file name, and (interim) not under a path the old pages own.
 * @param {import('fastify').FastifyRequest} req
 */
export function isSpaRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (wantsJson(req)) return false;
  const path = req.url.split('?')[0];
  return !FILE_NAMESPACE.test(path) && !FILE_EXTENSION.test(path) && !OLD_UI.test(path);
}

const htmlHeaders = (reply) => reply.type('text/html; charset=utf-8')
  .header('Content-Security-Policy', SPA_CSP).header('X-Frame-Options', 'SAMEORIGIN');

/**
 * Serve the web app from `dir`: hashed `/app/*` files immutable, other files `public, max-age=0`, and a not-found
 * handler that answers web-app routes with index.html (503 one-line page when the app is not built) and everything else
 * with `notFound`. Call it after every other route so the static wildcard only sees paths no route claims. A missing
 * `dir` registers no static route and never fails startup.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ dir: string, notFound: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => unknown }} opts
 */
export function spaRoutes(app, { dir, notFound }) {
  const indexFile = join(dir, 'index.html');
  const appDir = join(dir, 'app') + sep;
  let index = null;
  const readIndex = () => {
    if (index === null && existsSync(indexFile)) index = readFileSync(indexFile);
    return index;
  };
  readIndex();

  if (existsSync(dir)) {
    app.register(fastifyStatic, {
      root: dir,
      prefix: '/',
      decorateReply: false,
      index: false,
      list: false,
      cacheControl: false,
      setHeaders: (reply, path) => {
        reply.header('Cache-Control', path.startsWith(appDir) ? CACHE_PUBLIC_IMMUTABLE : 'public, max-age=0');
        if (/\.html?$/i.test(path)) reply.header('Content-Security-Policy', SPA_CSP).header('X-Frame-Options', 'SAMEORIGIN');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (!isSpaRequest(req)) return notFound(req, reply);
    const body = readIndex();
    if (!body) return htmlHeaders(reply).code(503).send(NOT_BUILT);
    return htmlHeaders(reply).code(200).send(body);
  });
}
