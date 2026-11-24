import { getTemplate, listTemplateErrors, listTemplates } from '../../services/templates.js';
import { formFields, resolveFields, resolveTemplateFields } from '../../services/fields.js';
import { generateDocument, previewDocument } from '../../services/generator.js';
import { getDocument } from '../../services/documents.js';
import { findEntities } from '../../services/entities.js';
import { DossierError, isDossierError } from '../../errors.js';
import { templatesPage } from '../views/templates.js';
import { generateFormPage, generateListPage } from '../views/generate.js';
import { errorReply, nestForm, seeOther, sendPage, shellOf, wantsJson } from '../http.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const getPath = (obj, path) => path.split('.').reduce((v, k) => (isObj(v) || Array.isArray(v) ? (Object.hasOwn(v, k) ? v[k] : undefined) : undefined), obj);

function setPath(obj, path, value) {
  const segs = path.split('.');
  let node = obj;
  for (const s of segs.slice(0, -1)) {
    if (!isObj(node[s])) return; // nothing posted under this path
    node = node[s];
  }
  const last = segs.at(-1);
  if (value === undefined) delete node[last];
  else node[last] = value;
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Turn a posted generate form into resolveFields input. Array rows with every cell blank are dropped (an empty list
 * is left out); a list without row columns and an object field are a textarea holding JSON, or (lists) one entry per
 * line. Blank scalars stay '' (resolveFields treats them as not provided).
 * @param {ReturnType<typeof formFields>} fields
 * @param {Record<string, string>} flat posted fields (without the `$` controls)
 * @returns {{ input: Record<string, unknown>, errors: Array<{ name: string, message: string }> }}
 */
export function formToInput(fields, flat) {
  const input = nestForm(flat);
  const errors = [];
  for (const f of fields) {
    const v = getPath(input, f.name);
    if (v === undefined) continue;
    if (f.type === 'array' && f.item) {
      const rows = (Array.isArray(v) ? v : []).filter((r) => isObj(r) && Object.values(r).some((x) => !blank(x)));
      setPath(input, f.name, rows.length ? rows : undefined);
    } else if ((f.type === 'array' || f.type === 'object') && typeof v === 'string') {
      const s = v.trim();
      if (s === '') { setPath(input, f.name, undefined); continue; }
      if (s.startsWith('[') || s.startsWith('{')) {
        try { setPath(input, f.name, JSON.parse(s)); } catch (e) { errors.push({ name: f.name, message: `not valid JSON (${e.message})` }); }
      } else if (f.type === 'array') {
        setPath(input, f.name, s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
      } else {
        errors.push({ name: f.name, message: 'expected a JSON object' });
      }
    }
  }
  return { input, errors };
}

/** Preview result for HTTP: file URLs instead of server paths. */
function previewView(r) {
  if (!r.ok) return { ok: false, missing: r.missing, errors: r.errors };
  return {
    ok: true,
    token: r.token,
    renditions: r.renditions.map((x) => ({ kind: x.kind, bytes: x.bytes, url: `/previews/${r.token}/preview.${x.kind}` })),
    warnings: r.warnings ?? [],
  };
}

const entrySummary = (t) => ({
  id: t.id, version: t.version, type: t.type, title: t.title, category: t.category, source: t.source,
  description: t.meta.description ?? null, sensitivity: t.meta.sensitivity, renditions: t.meta.renditions,
  numbering: t.meta.numbering ?? null, ...(t.inherits ? { inherits: true } : {}),
});

/** Options shared by the API bodies: `{ input, brandId, … }`. */
function apiBody(body) {
  const b = body ?? {};
  if (!isObj(b)) throw invalid('The request body must be a JSON object');
  const input = b.input ?? {};
  if (!isObj(input)) throw invalid('input must be an object', { input });
  return { ...b, input };
}

/**
 * Templates page, the generate pages and `/api/templates*`.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function templateRoutes(app, { ctx }) {
  const shell = () => shellOf(ctx);

  // ----- pages
  app.get('/templates', (req, reply) => sendPage(reply, templatesPage({ shell: shell(), templates: listTemplates(ctx), errors: listTemplateErrors(ctx) })));
  app.get('/generate', (req, reply) => sendPage(reply, generateListPage({ shell: shell(), templates: listTemplates(ctx) })));

  /** Render the generate form; `state` carries the posted input, problems and preview. */
  async function formPage(reply, templateId, state = {}, status = 200) {
    const template = await getTemplate(ctx, templateId);
    const regenerate = state.regenerate ?? null;
    const brandId = state.brandId || regenerate?.issuingBrandId || ctx.ws.config.defaultBrand;
    const fields = formFields(ctx, template, { brandId });
    const input = state.input ?? {};
    let resolved = { values: {}, missing: [], errors: [] };
    try {
      resolved = resolveTemplateFields(ctx, template, input, { brandId });
    } catch (err) {
      if (!isDossierError(err)) throw err;
    }
    const kinds = [...new Set(fields.map((f) => f.entityKind).filter(Boolean))];
    const entityOptions = Object.fromEntries(kinds.map((k) => [k, findEntities(ctx, { kind: k, limit: 500 })]));
    return sendPage(reply, generateFormPage({
      shell: shell(),
      template,
      fields,
      input,
      resolved,
      brands: [...ctx.ws.brands.values()].map((b) => ({ id: b.id, name: b.legalName })),
      brandId,
      entityOptions,
      regenerate: regenerate ? { id: regenerate.id, status: regenerate.status } : null,
      force: state.force ?? false,
      note: state.note ?? '',
      preview: state.preview ?? null,
      problems: state.problems ?? null,
      error: state.error ?? null,
    }), status);
  }

  app.get('/generate/:id', async (req, reply) => {
    let regenerate = null;
    let input = {};
    if (req.query.documentId) {
      const doc = getDocument(ctx, String(req.query.documentId));
      if (doc.template?.id !== req.params.id) throw invalid(`${doc.id} was not generated from template "${req.params.id}"`);
      regenerate = { id: doc.id, status: doc.status, issuingBrandId: doc.issuingBrandId };
      const current = doc.versions.find((v) => v.isCurrent);
      if (isObj(current?.input)) input = current.input;
    }
    return formPage(reply, req.params.id, { regenerate, input });
  });

  /** Parse the posted form; returns everything the handlers need. */
  async function readForm(req) {
    const body = req.body ?? {};
    const controls = {};
    const flat = {};
    for (const [k, v] of Object.entries(body)) {
      if (k.startsWith('$')) controls[k.slice(1)] = String(v ?? '').trim();
      else flat[k] = v;
    }
    const template = await getTemplate(ctx, req.params.id);
    let regenerate = null;
    if (controls.documentId) {
      const doc = getDocument(ctx, controls.documentId);
      regenerate = { id: doc.id, status: doc.status, issuingBrandId: doc.issuingBrandId };
    }
    const brandId = regenerate?.issuingBrandId || controls.brand || undefined;
    const fields = formFields(ctx, template, { brandId });
    const { input, errors } = formToInput(fields, flat);
    return { controls, input, errors, regenerate, brandId, force: controls.force === 'true', note: controls.note ?? '' };
  }

  async function preview(req, reply) {
    const form = await readForm(req);
    const json = wantsJson(req);
    const base = { regenerate: form.regenerate, brandId: form.brandId, input: form.input, force: form.force, note: form.note };
    if (form.errors.length) {
      const view = { ok: false, missing: [], errors: form.errors };
      return json ? reply.code(400).send(view) : formPage(reply, req.params.id, { ...base, problems: view }, 400);
    }
    const view = previewView(await previewDocument(ctx, req.params.id, form.input, { brandId: form.brandId }));
    if (json) return reply.code(view.ok ? 200 : 400).send(view);
    return formPage(reply, req.params.id, { ...base, preview: view, problems: view.ok ? null : view }, view.ok ? 200 : 400);
  }

  app.post('/generate/:id/preview', preview);

  app.post('/generate/:id', async (req, reply) => {
    if (String(req.body?.$action ?? '') === 'preview') return preview(req, reply);
    const form = await readForm(req);
    const base = { regenerate: form.regenerate, brandId: form.brandId, input: form.input, force: form.force, note: form.note };
    if (form.errors.length) return formPage(reply, req.params.id, { ...base, problems: { missing: [], errors: form.errors } }, 400);
    try {
      const r = await generateDocument(ctx, req.params.id, form.input, {
        ...(form.regenerate ? { documentId: form.regenerate.id, force: form.force } : { brandId: form.brandId }),
        ...(form.note ? { note: form.note } : {}),
      });
      const q = new URLSearchParams({ generated: '1' });
      if (r.warnings.length) q.set('warn', r.warnings.map((w) => w.name).join(','));
      return seeOther(reply, `/documents/${encodeURIComponent(r.documentId)}?${q}`);
    } catch (err) {
      if (!isDossierError(err)) throw err;
      const { status, body } = errorReply(err);
      if (err.code === 'FIELDS_MISSING' || err.code === 'FIELDS_INVALID') {
        return formPage(reply, req.params.id, { ...base, problems: { missing: err.details.missing ?? [], errors: err.details.errors ?? [] } }, status);
      }
      return formPage(reply, req.params.id, { ...base, error: body }, status);
    }
  });

  // ----- JSON API
  app.get('/api/templates', () => ({ templates: listTemplates(ctx).map(entrySummary), errors: listTemplateErrors(ctx) }));

  app.get('/api/templates/:id', async (req) => {
    const t = await getTemplate(ctx, req.params.id);
    const brandId = req.query.brandId ? String(req.query.brandId) : undefined;
    return { id: t.id, version: t.meta.version, source: t.source, hash: t.hash, meta: t.meta, fields: formFields(ctx, t, { brandId }) };
  });

  app.post('/api/templates/:id/resolve', async (req) => {
    const { input, brandId, today } = apiBody(req.body);
    return resolveFields(ctx, req.params.id, input, { brandId, today });
  });

  app.post('/api/templates/:id/preview', async (req, reply) => {
    const { input, brandId, today } = apiBody(req.body);
    const view = previewView(await previewDocument(ctx, req.params.id, input, { brandId, today }));
    return reply.code(view.ok ? 200 : 400).send(view);
  });

  app.post('/api/templates/:id/generate', async (req, reply) => {
    const { input, brandId, status, documentId, force, note, today } = apiBody(req.body);
    const opts = Object.fromEntries(Object.entries({ brandId, status, documentId, force, note, today }).filter(([, v]) => v !== undefined));
    return reply.code(201).send(await generateDocument(ctx, req.params.id, input, opts));
  });
}
