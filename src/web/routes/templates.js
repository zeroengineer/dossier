import { getTemplate, listTemplateErrors, listTemplates } from '../../services/templates.js';
import { formFields, resolveFields } from '../../services/fields.js';
import { generateDocument, previewDocument } from '../../services/generator.js';
import { DossierError } from '../../errors.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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
 * `/api/templates*`: list, fields, resolve, preview and generate.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function templateRoutes(app, { ctx }) {
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
