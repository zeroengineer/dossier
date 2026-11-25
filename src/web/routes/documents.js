import {
  countDocuments, getDocument, linkDocuments, listDocuments, readRendition, unlinkDocuments, updateMetadata, updateStatus,
} from '../../services/documents.js';
import { DossierError } from '../../errors.js';
import { sendFile } from '../http.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);

/** `?version=` as a positive integer, or undefined. */
function versionOf(q) {
  if (q === undefined || q === '') return undefined;
  if (!/^\d+$/.test(String(q))) throw invalid('version must be a positive integer', { version: q });
  return Number(q);
}

/** Numeric filters arrive as strings in a query; listDocuments wants numbers for limit/offset. */
function listFilters(query) {
  const out = {};
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === '') continue;
    out[k] = (k === 'limit' || k === 'offset') && /^\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}

/**
 * Document renditions (`/documents/:id/renditions/:kind`, linked from the web app) and the JSON API.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function documentRoutes(app, { ctx }) {
  // Rendition bytes, gated by the document's sensitivity (readRendition) before any 304. The URL follows the current
  // version, so the browser revalidates every time (private, no-cache) against the blob's sha256.
  const rendition = (req, reply) => {
    const out = readRendition(ctx, req.params.id, { kind: req.params.kind, versionNo: versionOf(req.query.version) });
    return sendFile(reply, out, { download: req.query.download !== undefined, req, etag: out.sha256, cacheControl: 'private, no-cache' });
  };
  app.get('/documents/:id/renditions/:kind', rendition);

  // ----- JSON API
  // `total` counts every match (ignoring limit/offset) so tables can page; `documents` is the requested page.
  app.get('/api/documents', (req) => {
    const filters = listFilters(req.query);
    return { documents: listDocuments(ctx, filters), total: countDocuments(ctx, filters) };
  });
  app.get('/api/documents/:id', (req) => getDocument(ctx, req.params.id));
  app.get('/api/documents/:id/renditions/:kind', rendition);
  app.post('/api/documents/:id/status', (req) => updateStatus(ctx, req.params.id, req.body?.status));
  app.post('/api/documents/:id/metadata', (req) => updateMetadata(ctx, req.params.id, req.body ?? {}));
  app.post('/api/documents/:id/links', (req, reply) => {
    const { toId, type, attrs } = req.body ?? {};
    return reply.code(201).send(linkDocuments(ctx, req.params.id, toId, type, attrs ?? {}));
  });
  app.delete('/api/documents/:id/links', (req) => {
    const { toId, type } = req.query;
    return { removed: unlinkDocuments(ctx, req.params.id, toId, type) };
  });
}
