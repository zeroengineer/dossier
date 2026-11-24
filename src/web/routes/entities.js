import { entityDocumentCount, findEntities, getEntity, relateEntities, upsertEntity } from '../../services/entities.js';
import { ENTITY_KINDS, ENTITY_RELATION_ROLES } from '../../domain/enums.js';
import { DossierError, isDossierError } from '../../errors.js';
import { entitiesPage, entityPage } from '../views/entities.js';
import { errorReply, field, seeOther, sendPage, shellOf } from '../http.js';

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);

/** Entity input from the create/edit form: aliases comma separated, attrs JSON, '' brand = none. */
export function entityInput(body, { editing = false } = {}) {
  const input = { name: field(body, 'name') };
  if (!editing) input.kind = field(body, 'kind');
  const aliases = field(body, 'aliases').split(',').map((a) => a.trim()).filter(Boolean);
  if (aliases.length) input.aliases = aliases;
  const attrs = field(body, 'attrs');
  if (attrs) {
    let parsed;
    try { parsed = JSON.parse(attrs); } catch { throw invalid('Attributes must be a JSON object'); }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid('Attributes must be a JSON object');
    input.attrs = parsed;
  }
  const brand = field(body, 'brand');
  if (brand) input.brand = brand;
  else if (editing && body.brand !== undefined) input.brand = null;
  return input;
}

const limitOf = (v) => (v === undefined || v === '' ? undefined : /^\d+$/.test(String(v)) ? Number(v) : v);

/**
 * Entity pages and `/api/entities`.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function entityRoutes(app, { ctx }) {
  const brands = () => [...ctx.ws.brands.keys()];
  const listPage = (reply, query, extra = {}, status = 200) => {
    const q = String(query.q ?? '');
    const kind = String(query.kind ?? '');
    return sendPage(reply, entitiesPage({
      shell: shellOf(ctx), q, kind, kinds: ENTITY_KINDS, brands: brands(),
      list: findEntities(ctx, { q, kind: kind || undefined, limit: 500 }), ...extra,
    }), status);
  };

  app.get('/entities', (req, reply) => listPage(reply, req.query));

  app.post('/entities', (req, reply) => {
    try {
      const e = upsertEntity(ctx, entityInput(req.body ?? {}));
      return seeOther(reply, `/entities/${e.id}?saved=1`);
    } catch (err) {
      if (!isDossierError(err)) throw err;
      const { status, body } = errorReply(err);
      return listPage(reply, {}, { values: req.body ?? {}, error: body }, status);
    }
  });

  const showPage = (reply, id, extra = {}, status = 200) => sendPage(reply, entityPage({
    shell: shellOf(ctx), entity: getEntity(ctx, id), roles: ENTITY_RELATION_ROLES, brands: brands(), ...extra,
  }), status);

  const entityId = (raw) => {
    if (!/^\d+$/.test(raw)) throw new DossierError('ENTITY_NOT_FOUND', `No entity ${raw}`, { ref: raw });
    return Number(raw);
  };

  app.get('/entities/:id', (req, reply) => showPage(reply, entityId(req.params.id), { message: req.query.saved ? 'Saved.' : null }));

  app.post('/entities/:id', (req, reply) => {
    const id = entityId(req.params.id);
    try {
      upsertEntity(ctx, { id, ...entityInput(req.body ?? {}, { editing: true }) });
      return seeOther(reply, `/entities/${id}?saved=1`);
    } catch (err) {
      if (!isDossierError(err) || err.code === 'ENTITY_NOT_FOUND') throw err;
      const { status, body } = errorReply(err);
      return showPage(reply, id, { error: body }, status);
    }
  });

  app.post('/entities/:id/relations', (req, reply) => {
    const id = entityId(req.params.id);
    try {
      const to = getEntity(ctx, field(req.body, 'to'));
      relateEntities(ctx, id, to.id, field(req.body, 'role'));
      return seeOther(reply, `/entities/${id}?saved=1`);
    } catch (err) {
      if (!isDossierError(err)) throw err;
      getEntity(ctx, id); // a missing page entity is a 404, not a form error
      const { status, body } = errorReply(err);
      return showPage(reply, id, { error: body }, status);
    }
  });

  // ----- JSON API
  // Each row carries `documentCount` (same figure as the detail view) for the entity list's table.
  app.get('/api/entities', (req) => ({
    entities: findEntities(ctx, { q: String(req.query.q ?? ''), kind: req.query.kind || undefined, limit: limitOf(req.query.limit) })
      .map((e) => ({ ...e, documentCount: entityDocumentCount(ctx, e.id) })),
  }));
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
