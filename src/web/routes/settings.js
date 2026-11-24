// Settings: overview, brand editor (sections, asset uploads, preview, download), series and workspace editors, and
// the JSON API for the same files. Writes go through src/services/workspaceFiles.js.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS_DIR } from '../../paths.js';
import { DossierError, isDossierError } from '../../errors.js';
import { listTemplates } from '../../services/templates.js';
import {
  brandRel, getBrandFile, getSeriesFile, getWorkspaceFile, storeBrandAsset, writeBrand, writeSeries, writeWorkspaceConfig,
} from '../../services/workspaceFiles.js';
import { renderBrandPreview } from '../../render/brandPreview.js';
import { applyBrandSection, BRAND_SECTIONS, newBrandBody, seriesFromForm, workspaceFromForm } from '../settingsForms.js';
import { brandPage, brandsPage, seriesPage, settingsPage, workspacePage } from '../views/settings.js';
import { errorReply, readMultipart, seeOther, sendFile, sendPage, shellOf } from '../http.js';

/** `builtin:<Family>-<Style>` names of the bundled fonts. */
function builtinFonts() {
  if (!existsSync(FONTS_DIR)) return [];
  return readdirSync(FONTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => readdirSync(join(FONTS_DIR, d.name))
    .filter((f) => /\.ttf$/i.test(f) && f.startsWith(`${d.name}-`))
    .map((f) => `builtin:${f.replace(/\.ttf$/i, '')}`)).sort();
}

const fieldErrors = (err) => (isDossierError(err, 'WORKSPACE_INVALID') ? err.details.errors : null);

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function settingsRoutes(app, { ctx }) {
  app.get('/settings', (req, reply) => sendPage(reply, settingsPage({
    shell: shellOf(ctx),
    info: {
      home: ctx.config.home,
      dataDir: ctx.config.dataDir,
      workspace: ctx.ws.config.name,
      defaultBrand: ctx.ws.config.defaultBrand,
      user: ctx.user,
      brands: [...ctx.ws.brands.values()].map((b) => ({ id: b.id, name: b.legalName, signatories: (b.signatories ?? []).map((s) => `${s.name} (${s.id})`) })),
      series: [...ctx.ws.series.values()].map((s) => ({ id: s.id, pattern: s.pattern, scope: s.scope })),
    },
  })));

  // ----- brands

  const brandList = () => [...ctx.ws.brands.values()].map((b) => ({ id: b.id, legalName: b.legalName, inheritsFrom: b.inheritsFrom }));
  const listPage = (reply, values = {}, error = null, status = 200) => sendPage(reply, brandsPage({ shell: shellOf(ctx), brands: brandList(), values, error }), status);

  app.get('/settings/brands', (req, reply) => listPage(reply));

  app.post('/settings/brands', (req, reply) => {
    const values = req.body ?? {};
    try {
      const body = newBrandBody(values);
      writeBrand(ctx, body.id, body, { create: true });
      return seeOther(reply, `/settings/brands/${encodeURIComponent(body.id)}?saved=identity`);
    } catch (err) {
      if (!isDossierError(err)) throw err;
      const { status, body } = errorReply(err);
      return listPage(reply, values, body, status);
    }
  });

  const editorPage = (reply, id, extra = {}, status = 200) => {
    const b = getBrandFile(ctx, id);
    return sendPage(reply, brandPage({
      shell: shellOf(ctx),
      id,
      own: b.file,
      parent: b.parent,
      resolved: b.resolved,
      configHash: b.configHash,
      seriesIds: [...ctx.ws.series.keys()],
      builtinFonts: builtinFonts(),
      ...extra,
    }), status);
  };

  app.get('/settings/brands/:id', (req, reply) => editorPage(reply, req.params.id, { saved: typeof req.query.saved === 'string' ? req.query.saved : null }));

  app.post('/settings/brands/:id', (req, reply) => {
    const { id } = req.params;
    const { file: own } = getBrandFile(ctx, id);
    const section = String(req.body?.$section ?? '');
    if (!BRAND_SECTIONS.includes(section)) throw new DossierError('INVALID_INPUT', `Unknown settings section "${section}"`, { section });
    const { body, errors } = applyBrandSection(own, section, req.body ?? {}, { inherits: Boolean(own.inheritsFrom) });
    try {
      if (errors.length) throw new DossierError('WORKSPACE_INVALID', 'Some fields are not valid', { file: brandRel(id), errors });
      writeBrand(ctx, id, body);
      return seeOther(reply, `/settings/brands/${encodeURIComponent(id)}?saved=${encodeURIComponent(section)}#sec-${section}`);
    } catch (err) {
      const list = fieldErrors(err);
      if (!list) throw err;
      return editorPage(reply, id, { own: body, errors: list, failedSection: section }, 400);
    }
  });

  app.post('/settings/brands/:id/assets', async (req, reply) => {
    const { id } = req.params;
    getBrandFile(ctx, id);
    const { file, fields } = await readMultipart(req);
    try {
      if (!file) throw new DossierError('INVALID_INPUT', 'Choose a file to upload');
      await storeBrandAsset(ctx, id, fields.key, file);
      return seeOther(reply, `/settings/brands/${encodeURIComponent(id)}?saved=upload`);
    } catch (err) {
      if (!isDossierError(err) || err.code === 'BRAND_NOT_FOUND') throw err;
      const list = fieldErrors(err);
      if (list) return editorPage(reply, id, { errors: list, failedSection: 'upload' }, 400);
      const { status, body } = errorReply(err);
      return editorPage(reply, id, { error: body }, status);
    }
  });

  app.get('/settings/brands/:id/brand.json', (req, reply) => {
    const { file } = getBrandFile(ctx, req.params.id);
    return sendFile(reply, { buffer: Buffer.from(`${JSON.stringify(file, null, 2)}\n`), filename: 'brand.json', mime: 'application/json' }, { download: true });
  });

  app.get('/settings/brands/:id/preview.pdf', async (req, reply) => {
    const { id } = getBrandFile(ctx, req.params.id);
    const buffer = await renderBrandPreview(ctx.ws, id);
    return sendFile(reply, { buffer, filename: `${id}-preview.pdf`, mime: 'application/pdf' });
  });

  // ----- series

  const seriesUsage = () => {
    const usage = {};
    const add = (sid, what) => { (usage[sid] ??= []).push(what); };
    for (const [bid, b] of ctx.ws.brands) for (const [tid, sid] of Object.entries(b.series)) add(sid, `${bid}: ${tid}`);
    for (const t of listTemplates(ctx)) if (t.meta.numbering?.series && t.meta.numbering.series !== 'brand') add(t.meta.numbering.series, `template ${t.id}`);
    return usage;
  };
  const seriesView = (reply, extra = {}, status = 200) => sendPage(reply, seriesPage({ shell: shellOf(ctx), list: getSeriesFile(ctx), usage: seriesUsage(), ...extra }), status);

  app.get('/settings/series', (req, reply) => seriesView(reply, { saved: req.query.saved !== undefined }));

  app.post('/settings/series', (req, reply) => {
    const { body, errors } = seriesFromForm(getSeriesFile(ctx), req.body ?? {});
    try {
      if (errors.length) throw new DossierError('WORKSPACE_INVALID', 'Some fields are not valid', { file: 'series.json', errors: errors.map((e) => ({ file: 'series.json', ...e })) });
      writeSeries(ctx, body);
      return seeOther(reply, '/settings/series?saved=1');
    } catch (err) {
      const list = fieldErrors(err);
      if (!list) throw err;
      return seriesView(reply, { list: body, errors: list }, 400);
    }
  });

  // ----- workspace.json

  const workspaceView = (reply, extra = {}, status = 200) => sendPage(reply, workspacePage({
    shell: shellOf(ctx), file: getWorkspaceFile(ctx), brandIds: [...ctx.ws.brands.keys()], ...extra,
  }), status);

  app.get('/settings/workspace', (req, reply) => workspaceView(reply, { saved: req.query.saved !== undefined }));

  app.post('/settings/workspace', (req, reply) => {
    const { body, errors } = workspaceFromForm(getWorkspaceFile(ctx), req.body ?? {});
    try {
      if (errors.length) throw new DossierError('WORKSPACE_INVALID', 'Some fields are not valid', { file: 'workspace.json', errors: errors.map((e) => ({ file: 'workspace.json', ...e })) });
      writeWorkspaceConfig(ctx, body);
      return seeOther(reply, '/settings/workspace?saved=1');
    } catch (err) {
      const list = fieldErrors(err);
      if (!list) throw err;
      return workspaceView(reply, { file: body, errors: list }, 400);
    }
  });

  // ----- JSON API

  const brandJson = (b) => ({ id: b.id, file: b.file, resolved: b.resolved, configHash: b.configHash });

  app.get('/api/brands', () => ({ brands: brandList() }));
  app.get('/api/brands/:id', (req) => brandJson(getBrandFile(ctx, req.params.id)));
  app.put('/api/brands/:id', (req, reply) => {
    const r = writeBrand(ctx, req.params.id, req.body);
    return reply.code(r.created ? 201 : 200).send(brandJson(r));
  });
  app.post('/api/brands/:id/assets/:key', async (req) => {
    const { id, key } = req.params;
    getBrandFile(ctx, id);
    const { file } = await readMultipart(req);
    if (!file) throw new DossierError('INVALID_INPUT', 'A multipart "file" part is required');
    const r = await storeBrandAsset(ctx, id, key, file);
    return { key: r.key, path: r.path, sha256: r.sha256, bytes: r.bytes, brand: brandJson(r) };
  });

  app.get('/api/series', () => ({ series: getSeriesFile(ctx) }));
  app.put('/api/series', (req) => {
    const body = req.body;
    return { series: writeSeries(ctx, Array.isArray(body) ? body : body?.series) };
  });

  app.get('/api/workspace', () => ({ workspace: getWorkspaceFile(ctx) }));
  app.put('/api/workspace', (req) => {
    const body = req.body;
    return { workspace: writeWorkspaceConfig(ctx, body?.workspace ?? body) };
  });
}
