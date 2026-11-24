import {
  getDocument, linkDocuments, listDocuments, readRendition, unlinkDocuments, updateMetadata, updateStatus,
  DOCUMENT_RELATION_TYPES,
} from '../../services/documents.js';
import { STATUSES } from '../../domain/status.js';
import { LEVELS } from '../../domain/sensitivity.js';
import { DossierError } from '../../errors.js';
import { documentPage } from '../views/document.js';
import { field, seeOther, sendFile, sendPage, shellOf } from '../http.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);
const docPath = (id) => `/documents/${encodeURIComponent(id)}`;

/** `?version=` as a positive integer, or undefined. */
function versionOf(q) {
  if (q === undefined || q === '') return undefined;
  if (!/^\d+$/.test(String(q))) throw invalid('version must be a positive integer', { version: q });
  return Number(q);
}

/** Metadata patch from the document page form: '' clears dates and the number, title must stay non-empty. */
function metadataPatch(body) {
  const patch = {};
  for (const k of ['title', 'docNumber', 'docDate', 'dueDate', 'sensitivity']) {
    if (body[k] === undefined) continue;
    const v = typeof body[k] === 'string' ? body[k].trim() : body[k];
    patch[k] = v === '' && k !== 'title' ? null : v;
  }
  return patch;
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
 * Document pages, forms, renditions and the JSON API.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function documentRoutes(app, { ctx }) {
  // ----- pages and form posts
  app.get('/documents/:id', (req, reply) => {
    const doc = getDocument(ctx, req.params.id);
    const generated = req.query.generated ? { warnings: String(req.query.warn ?? '').split(',').filter(Boolean) } : null;
    let message = null;
    if (req.query.uploaded) message = `File uploaded${req.query.deduped ? ' (identical bytes were already stored; the file is shared)' : ''}${req.query.warn ? ` — warning: ${req.query.warn}` : ''}.`;
    if (req.query.saved) message = 'Saved.';
    return sendPage(reply, documentPage({
      doc, shell: shellOf(ctx), statuses: STATUSES, relationTypes: DOCUMENT_RELATION_TYPES, levels: LEVELS, generated, message,
    }));
  });

  app.post('/documents/:id/status', (req, reply) => {
    updateStatus(ctx, req.params.id, field(req.body, 'status'));
    return seeOther(reply, `${docPath(req.params.id)}?saved=1`);
  });

  app.post('/documents/:id/links', (req, reply) => {
    linkDocuments(ctx, req.params.id, field(req.body, 'toId'), field(req.body, 'type'));
    return seeOther(reply, `${docPath(req.params.id)}?saved=1`);
  });

  app.post('/documents/:id/links/delete', (req, reply) => {
    const from = field(req.body, 'fromId');
    const to = field(req.body, 'toId');
    if (from !== req.params.id && to !== req.params.id) throw invalid('The relation must involve this document');
    getDocument(ctx, req.params.id); // access check on the page's document
    unlinkDocuments(ctx, from, to, field(req.body, 'type'));
    return seeOther(reply, `${docPath(req.params.id)}?saved=1`);
  });

  app.post('/documents/:id/metadata', (req, reply) => {
    updateMetadata(ctx, req.params.id, metadataPatch(req.body ?? {}));
    return seeOther(reply, `${docPath(req.params.id)}?saved=1`);
  });

  // Rendition bytes, gated by the document's sensitivity (readRendition) before any 304. The URL follows the current
  // version, so the browser revalidates every time (private, no-cache) against the blob's sha256.
  const rendition = (req, reply) => {
    const out = readRendition(ctx, req.params.id, { kind: req.params.kind, versionNo: versionOf(req.query.version) });
    return sendFile(reply, out, { download: req.query.download !== undefined, req, etag: out.sha256, cacheControl: 'private, no-cache' });
  };
  app.get('/documents/:id/renditions/:kind', rendition);

  // ----- JSON API
  app.get('/api/documents', (req) => ({ documents: listDocuments(ctx, listFilters(req.query)) }));
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
