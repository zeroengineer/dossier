import { uploadFile } from '../../services/upload.js';
import { findEntities } from '../../services/entities.js';
import { coerceMoney } from '../../services/fields.js';
import { DEFAULT_ROUTES } from '../../domain/routing.js';
import { STATUSES } from '../../domain/status.js';
import { LEVELS } from '../../domain/sensitivity.js';
import { PARTY_TYPES } from '../../domain/enums.js';
import { DossierError, isDossierError } from '../../errors.js';
import { uploadPage } from '../views/upload.js';
import { errorReply, readMultipart, seeOther, sendPage, shellOf } from '../http.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);
const PARTY_KINDS = ['company', 'group_entity', 'person', 'client', 'vendor', 'product'];
const TEXT_KEYS = ['type', 'title', 'partyType', 'docNumber', 'numberSeries', 'docDate', 'dueDate', 'currency', 'status', 'sensitivity'];

/**
 * uploadFile `meta` from multipart text fields. Blank fields are left out (the service defaults apply). `amount` is a
 * decimal amount turned into `amountMinor` (currency defaulting to `defaultCurrency`); `partyId` an entity id; `meta`
 * (API) a JSON object merged over the rest.
 * @param {Record<string, string>} f
 * @param {{ defaultCurrency?: string }} [opts]
 * @returns {Record<string, unknown>}
 */
export function uploadMeta(f, { defaultCurrency } = {}) {
  const val = (k) => (typeof f[k] === 'string' ? f[k].trim() : '');
  const meta = {};
  if (val('documentId')) {
    meta.documentId = val('documentId');
    if (val('note')) meta.note = val('note');
    if (val('makeCurrent')) meta.makeCurrent = ['true', 'on', '1', 'yes'].includes(val('makeCurrent').toLowerCase());
  } else {
    for (const k of TEXT_KEYS) if (val(k)) meta[k] = val(k);
    if (val('partyId')) {
      if (!/^\d+$/.test(val('partyId'))) throw invalid('partyId must be an entity id', { partyId: val('partyId') });
      meta.partyId = Number(val('partyId'));
    }
    if (val('amount')) {
      const r = coerceMoney(val('amount'));
      if (r.error) throw invalid(`amount: ${r.error}`, { amount: val('amount') });
      meta.amountMinor = r.value;
      if (!meta.currency && defaultCurrency) meta.currency = defaultCurrency;
    }
  }
  if (val('meta')) {
    let extra;
    try { extra = JSON.parse(val('meta')); } catch { throw invalid('meta must be a JSON object'); }
    if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) throw invalid('meta must be a JSON object');
    Object.assign(meta, extra);
  }
  return meta;
}

/**
 * Upload page and `POST /api/upload` (multipart: `file` plus metadata fields or a `meta` JSON field).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function uploadRoutes(app, { ctx }) {
  const page = (reply, values = {}, error = null, status = 200) => sendPage(reply, uploadPage({
    shell: shellOf(ctx),
    types: Object.keys(DEFAULT_ROUTES).sort(),
    parties: findEntities(ctx, { limit: 500 }).filter((e) => PARTY_KINDS.includes(e.kind)),
    statuses: STATUSES.filter((s) => s !== 'Draft'),
    levels: LEVELS,
    partyTypes: PARTY_TYPES,
    values,
    error,
  }), status);

  app.get('/upload', (req, reply) => page(reply, { documentId: String(req.query.documentId ?? '') }));

  app.post('/upload', async (req, reply) => {
    const { file, fields } = await readMultipart(req);
    try {
      if (!file) throw invalid('Choose a file to upload');
      const r = await uploadFile(ctx, { ...file, meta: uploadMeta(fields, { defaultCurrency: ctx.ws.config.locale?.currencyCode }) });
      const q = new URLSearchParams({ uploaded: '1' });
      if (r.deduped) q.set('deduped', '1');
      if (r.warnings.length) q.set('warn', r.warnings.join(','));
      return seeOther(reply, `/documents/${encodeURIComponent(r.document.id)}?${q}`);
    } catch (err) {
      if (!isDossierError(err)) throw err;
      const { status, body } = errorReply(err);
      return page(reply, fields, body, status);
    }
  });

  app.post('/api/upload', async (req, reply) => {
    const { file, fields } = await readMultipart(req);
    if (!file) throw invalid('A multipart "file" part is required');
    const r = await uploadFile(ctx, { ...file, meta: uploadMeta(fields, { defaultCurrency: ctx.ws.config.locale?.currencyCode }) });
    return reply.code(201).send(r);
  });
}
