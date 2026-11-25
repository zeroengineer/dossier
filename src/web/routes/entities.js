import { entityDocumentCounts, findEntities, getEntity, relateEntities, upsertEntity } from '../../services/entities.js';
import { DossierError } from '../../errors.js';

const limitOf = (v) => (v === undefined || v === '' ? undefined : /^\d+$/.test(String(v)) ? Number(v) : v);

/**
 * `/api/entities`.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function entityRoutes(app, { ctx }) {
  const entityId = (raw) => {
    if (!/^\d+$/.test(raw)) throw new DossierError('ENTITY_NOT_FOUND', `No entity ${raw}`, { ref: raw });
    return Number(raw);
  };

  // Each row carries `documentCount` (same query as the detail view, one statement for every row).
  app.get('/api/entities', (req) => {
    const entities = findEntities(ctx, { q: String(req.query.q ?? ''), kind: req.query.kind || undefined, limit: limitOf(req.query.limit) });
    const counts = entityDocumentCounts(ctx, entities.map((e) => e.id));
    return { entities: entities.map((e) => ({ ...e, documentCount: counts.get(e.id) ?? 0 })) };
  });
  app.get('/api/entities/:id', (req) => getEntity(ctx, /^\d+$/.test(req.params.id) ? Number(req.params.id) : req.params.id, { kind: req.query.kind || undefined }));
  app.post('/api/entities', (req, reply) => {
    const body = req.body ?? {};
    const existed = body.id !== undefined && body.id !== null;
    const e = upsertEntity(ctx, body);
    return reply.code(existed ? 200 : 201).send(e);
  });
  app.post('/api/entities/:id/relations', (req, reply) => {
    const { to, role, attrs } = req.body ?? {};
    const target = getEntity(ctx, to);
    return reply.code(201).send(relateEntities(ctx, entityId(req.params.id), target.id, role, attrs));
  });
}
