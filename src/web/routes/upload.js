import { uploadFile } from '../../services/upload.js';
import { coerceMoney } from '../../services/fields.js';
import { DossierError } from '../../errors.js';
import { readMultipart } from '../http.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);
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
 * `POST /api/upload` (multipart: `file` plus metadata fields or a `meta` JSON field).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function uploadRoutes(app, { ctx }) {
  app.post('/api/upload', async (req, reply) => {
    const { file, fields } = await readMultipart(req);
    if (!file) throw invalid('A multipart "file" part is required');
    const r = await uploadFile(ctx, { ...file, meta: uploadMeta(fields, { defaultCurrency: ctx.ws.config.locale?.currencyCode }) });
    return reply.code(201).send(r);
  });
}
