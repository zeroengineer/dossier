// Serving the built web app (web/dist): static files, and index.html as the fallback for client-side routes.
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import { API_PATH, CACHE_PUBLIC_IMMUTABLE, wantsJson } from './http.js';

/**
 * Content-Security-Policy of every HTML reply (the web app's index.html and the not-built page). Radix and Recharts
 * set inline styles; Vite emits no inline scripts.
 */
export const SPA_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
  + "font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

/**
 * Paths that name files (bundle, backend files, renditions); a miss there is a real 404, never the web app. `/static/`
 * stays listed so links to the removed server-rendered UI's CSS/JS get a 404 rather than the app.
 */
const FILE_NAMESPACE = /^\/(?:(?:app|assets|blobs|previews|brand|static)(?:\/|$)|documents\/[^/]+\/renditions(?:\/|$)|favicon\.ico$)/i;

/** A last path segment that names a file (`/workspace.json`, `/robots.txt`): a miss is a 404, not a client route. */
const FILE_EXTENSION = /\.(?:json|m?js|css|map|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|pdf|html?|md|ttf|otf|woff2?|webmanifest|db|sqlite)$/i;

const NOT_BUILT = '<!doctype html><title>Dossier</title><p>The web app is not built: run <code>npm run build</code> and restart the server.</p>\n';

/** A path that must never get index.html: `/api` (any case), a file namespace, or a file name. */
const notAppPath = (path) => API_PATH.test(path) || FILE_NAMESPACE.test(path) || FILE_EXTENSION.test(path);

/**
 * True when an unmatched request should get the web app's index.html: GET/HEAD, not JSON-accepting, and neither the
 * raw nor the percent-decoded path is under `/api`, a file namespace or a file name (`/%61pp/x.js` is `/app/x.js` to
 * the router and the static files). A path that does not decode is not an app route.
 * @param {import('fastify').FastifyRequest} req
 */
export function isSpaRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (wantsJson(req)) return false;
  const raw = req.url.split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false;
  }
  return !notAppPath(raw) && !notAppPath(decoded);
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
      // A directory URL (`/`, `/app/`) is never a file: pass it to the not-found handler (the app for `/`, a 404 under
      // a file namespace) instead of the plugin's 403.
      allowedPath: (pathName) => !pathName.endsWith('/'),
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
