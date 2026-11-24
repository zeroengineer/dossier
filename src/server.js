// HTTP entry: wires the web UI and JSON API (src/web) onto Fastify. No business logic here: routes call services.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { loadConfig } from './config.js';
import { openContext } from './context.js';
import { FONTS_DIR, REPO_ROOT } from './paths.js';
import {
  crossSiteReason, errorReply, hostAllowed, parseUrlEncoded, sendPage, shellOf, wantsJson,
} from './web/http.js';
import { errorPage } from './web/views/error.js';
import assetRoutes from './web/routes/assets.js';
import vaultRoutes from './web/routes/vault.js';
import documentRoutes from './web/routes/documents.js';
import uploadRoutes from './web/routes/upload.js';
import searchRoutes from './web/routes/search.js';
import templateRoutes from './web/routes/templates.js';
import entityRoutes from './web/routes/entities.js';
import settingsRoutes from './web/routes/settings.js';

/** Host names accepted when the server listens on a loopback address. */
export const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'self'; "
  + "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

/**
 * Build the Fastify app for one context (one workspace, one acting user).
 * @param {object} ctx from openContext
 * @param {{ allowedHosts?: string[]|null, logger?: boolean|object, fileSizeLimit?: number }} [opts]
 *   allowedHosts: Host header names accepted (default loopback names; null accepts any host);
 *   fileSizeLimit: largest upload in bytes (default 50 MB)
 * @returns {import('fastify').FastifyInstance}
 */
export function buildServer(ctx, { allowedHosts = LOOPBACK_HOSTS, logger = false, fileSizeLimit = 50 * 1024 * 1024 } = {}) {
  const app = Fastify({ logger });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try {
      done(null, parseUrlEncoded(body));
    } catch (err) {
      err.statusCode = 400;
      done(err);
    }
  });
  app.register(fastifyMultipart, { limits: { fileSize: fileSizeLimit, files: 1, fields: 100 }, throwFileSizeLimit: true });
  // Shipped fonts and the app's CSS/JS keep their names across releases, so browsers revalidate them
  // (`public, max-age=0`; the plugin's ETag / Last-Modified give a 304) instead of caching them for good.
  const statics = { decorateReply: false, index: false, list: false, maxAge: 0 };
  app.register(fastifyStatic, { root: FONTS_DIR, prefix: '/assets/fonts/', ...statics });
  app.register(fastifyStatic, { root: join(REPO_ROOT, 'src', 'web', 'public'), prefix: '/static/', ...statics });

  // Host check (DNS rebinding) and same-origin check for state-changing requests (CSRF); see crossSiteReason.
  app.addHook('onRequest', async (req, reply) => {
    if (!hostAllowed(req.headers.host, allowedHosts)) {
      return reply.code(421).type('application/json').send({ code: 'HOST_REJECTED', message: `Host "${req.headers.host}" is not served here`, details: {} });
    }
    const reason = crossSiteReason(req);
    if (reason) return reply.code(403).type('application/json').send({ code: 'CSRF_REJECTED', message: reason, details: {} });
    return undefined;
  });

  app.addHook('onSend', async (req, reply, payload) => {
    // Pages, API JSON, redirects and errors are never stored; file routes set their own Cache-Control.
    if (!reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html') && !reply.getHeader('content-security-policy')) {
      reply.header('Content-Security-Policy', PAGE_CSP);
      reply.header('X-Frame-Options', 'SAMEORIGIN');
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    const out = errorReply(err);
    if (out.status >= 500) req.log.error(err);
    if (wantsJson(req)) return reply.code(out.status).send(out.body);
    return sendPage(reply, errorPage(out, shellOf(ctx)), out.status);
  });

  app.setNotFoundHandler((req, reply) => {
    const out = { status: 404, body: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.url.split('?')[0]}`, details: {} } };
    if (wantsJson(req)) return reply.code(404).send(out.body);
    return sendPage(reply, errorPage(out, shellOf(ctx)), 404);
  });

  for (const routes of [assetRoutes, vaultRoutes, documentRoutes, uploadRoutes, searchRoutes, templateRoutes, entityRoutes, settingsRoutes]) {
    app.register(routes, { ctx });
  }
  return app;
}

const isLoopback = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) || /^127\./.test(host);

/**
 * Open the workspace from the environment and listen. HOST (default 127.0.0.1) and PORT (default 4400) choose the
 * address; on a non-loopback HOST any Host header is accepted unless DOSSIER_ALLOWED_HOSTS (comma separated) lists them.
 * @param {{ env?: Record<string, string|undefined>, cwd?: string, host?: string, port?: number, logger?: boolean|object }} [opts]
 * @returns {Promise<{ app: import('fastify').FastifyInstance, url: string }>}
 */
export async function start({ env = process.env, cwd = process.cwd(), host, port, logger = false } = {}) {
  const config = loadConfig(env, cwd);
  const ctx = openContext({ home: config.home, env });
  const h = host ?? env.HOST ?? '127.0.0.1';
  const listed = (env.DOSSIER_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowedHosts = listed.length ? listed : isLoopback(h) ? LOOPBACK_HOSTS : null;
  const app = buildServer(ctx, { allowedHosts, logger });
  app.addHook('onClose', async () => ctx.close());
  try {
    await app.listen({ host: h, port: port ?? config.port });
  } catch (err) {
    await app.close();
    throw err;
  }
  const addr = app.server.address();
  const shown = h.includes(':') ? `[${h}]` : h;
  return { app, url: `http://${shown}:${typeof addr === 'object' && addr ? addr.port : port ?? config.port}` };
}

const runDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (runDirectly) {
  const { app, url } = await start({ logger: true });
  process.stdout.write(`Dossier is running at ${url}\n`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { app.close().then(() => process.exit(0)); });
}
