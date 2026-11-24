// HTTP entry: wires the web UI and JSON API (src/web) onto Fastify. No business logic here: routes call services.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { loadConfig } from './config.js';
import { DossierError } from './errors.js';
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
import metaRoutes from './web/routes/meta.js';
import { SPA_CSP, spaRoutes } from './web/spa.js';

/** Host names accepted when the server listens on a loopback address. */
export const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/** Content-Security-Policy of the server-rendered pages (until the web app replaces them). */
export const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'self'; "
  + "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

export { SPA_CSP };

/** Where `npm run build` puts the web app. */
export const SPA_DIR = join(REPO_ROOT, 'web', 'dist');

/**
 * Build the Fastify app for one context (one workspace, one acting user).
 * @param {object} ctx from openContext
 * @param {{ allowedHosts?: string[]|null, logger?: boolean|object, fileSizeLimit?: number, spaDir?: string }} [opts]
 *   allowedHosts: Host header names accepted (default loopback names; null accepts any host);
 *   fileSizeLimit: largest upload in bytes (default 50 MB);
 *   spaDir: the built web app (default `web/dist`; a missing folder answers its routes with 503)
 * @returns {import('fastify').FastifyInstance}
 */
export function buildServer(ctx, { allowedHosts = LOOPBACK_HOSTS, logger = false, fileSizeLimit = 50 * 1024 * 1024, spaDir = SPA_DIR } = {}) {
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

  const notFound = (req, reply) => {
    const out = { status: 404, body: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.url.split('?')[0]}`, details: {} } };
    if (wantsJson(req)) return reply.code(404).send(out.body);
    return sendPage(reply, errorPage(out, shellOf(ctx)), 404);
  };

  for (const routes of [assetRoutes, vaultRoutes, documentRoutes, uploadRoutes, searchRoutes, templateRoutes, entityRoutes, settingsRoutes, metaRoutes]) {
    app.register(routes, { ctx, fileSizeLimit });
  }
  // Last: the web app's static files and its index.html for unmatched GET/HEAD page routes (other misses: notFound).
  spaRoutes(app, { dir: spaDir, notFound });
  return app;
}

const isLoopback = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) || /^127\./.test(host);

/**
 * Open the workspace from the environment and listen. HOST (default 127.0.0.1) and PORT (default 4400) choose the
 * address. A non-loopback HOST needs DOSSIER_ALLOWED_HOSTS (comma separated host names the server answers); without it
 * the server refuses to start (HOST_UNSAFE), unless DOSSIER_ALLOW_ANY_HOST=1, which accepts any Host header and prints
 * a warning to stderr. The vault has no login, so anyone who can reach the port acts as DOSSIER_USER.
 * @param {{ env?: Record<string, string|undefined>, cwd?: string, host?: string, port?: number, logger?: boolean|object,
 *   warn?: (message: string) => void }} [opts] warn: where the any-host warning goes (default stderr)
 * @returns {Promise<{ app: import('fastify').FastifyInstance, url: string }>}
 */
export async function start({ env = process.env, cwd = process.cwd(), host, port, logger = false, warn = (m) => process.stderr.write(m) } = {}) {
  const config = loadConfig(env, cwd);
  const h = host ?? env.HOST ?? '127.0.0.1';
  const listed = (env.DOSSIER_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!listed.length && !isLoopback(h)) {
    if (env.DOSSIER_ALLOW_ANY_HOST !== '1') {
      throw new DossierError('HOST_UNSAFE',
        `Refusing to listen on non-loopback HOST "${h}" without DOSSIER_ALLOWED_HOSTS: Dossier has no login, so any Host `
        + 'header would be answered (DNS rebinding) and anyone who can reach the port could read and change the vault. '
        + 'Set DOSSIER_ALLOWED_HOSTS to the host names you serve (and put an authenticating reverse proxy in front), or '
        + 'set DOSSIER_ALLOW_ANY_HOST=1 to accept any Host anyway.', { host: h });
    }
    warn(`WARNING: Dossier is listening on non-loopback HOST "${h}" and answers ANY Host header (DOSSIER_ALLOW_ANY_HOST=1). `
      + 'There is no login: anyone who can reach this port acts as DOSSIER_USER with full access. '
      + 'Set DOSSIER_ALLOWED_HOSTS and use an authenticating reverse proxy.\n');
  }
  const allowedHosts = listed.length ? listed : isLoopback(h) ? LOOPBACK_HOSTS : null;
  const ctx = openContext({ home: config.home, env });
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
  const { app, url } = await start({ logger: true }).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
  process.stdout.write(`Dossier is running at ${url}\n`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { app.close().then(() => process.exit(0)); });
}
