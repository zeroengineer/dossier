import { search } from '../../services/search.js';
import { isDossierError } from '../../errors.js';
import { searchPage } from '../views/search.js';
import { errorReply, sendPage, shellOf } from '../http.js';

const list = (v) => (v === undefined || v === '' ? undefined : String(v).split(',').map((s) => s.trim()).filter(Boolean));

/**
 * search() options from a query string: `q`, `types` and `status` (comma separated or repeated), `partyId`, `from`,
 * `to`, `limit`, `expand` (`0`/`false` turns it off).
 * @param {Record<string, string|string[]>} query
 */
export function searchOptions(query) {
  const one = (v) => (Array.isArray(v) ? v.join(',') : v);
  const opts = { q: String(one(query.q) ?? '') };
  const types = list(one(query.types));
  const status = list(one(query.status));
  if (types) opts.types = types;
  if (status) opts.status = status;
  for (const k of ['partyId', 'from', 'to']) if (query[k] !== undefined && query[k] !== '') opts[k] = String(one(query[k]));
  if (query.limit !== undefined && query.limit !== '') opts.limit = /^\d+$/.test(String(query.limit)) ? Number(query.limit) : query.limit;
  if (query.expand !== undefined) opts.expand = !['0', 'false', 'no'].includes(String(query.expand).toLowerCase());
  return opts;
}

/**
 * `/search?q=` page and `GET /api/search`.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function searchRoutes(app, { ctx }) {
  app.get('/search', (req, reply) => {
    const opts = searchOptions(req.query);
    if (!opts.q.trim()) return sendPage(reply, searchPage({ shell: shellOf(ctx), q: '', result: null }));
    try {
      return sendPage(reply, searchPage({ shell: shellOf(ctx), q: opts.q, result: search(ctx, opts) }));
    } catch (err) {
      if (!isDossierError(err)) throw err;
      const { status, body } = errorReply(err);
      return sendPage(reply, searchPage({ shell: shellOf(ctx), q: opts.q, result: null, error: body }), status);
    }
  });

  app.get('/api/search', (req) => search(ctx, searchOptions(req.query)));
}
