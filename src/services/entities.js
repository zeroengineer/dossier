import { normaliseName } from '../domain/canonical.js';
import { DossierError } from '../errors.js';
import { nowIso } from '../db/index.js';
import { reindexEntityDocuments } from './searchIndex.js';
import { memoOf } from '../cache/memo.js';
import { ENTITY_KINDS, ENTITY_RELATION_ROLES, SeedsSchema, formatIssues } from '../workspace/schemas.js';

export { normaliseName };

/** Event emitted (after commit) whenever entities, their aliases or relations change. Payload: `{ ids: number[] }`. */
export const ENTITY_CHANGED = 'entity:changed';

const MAX_LIMIT = 500;
/** Tables an entity view is built from (memo dependencies): the entity, its relations and its document count. */
const ENTITY_DEPS = ['entities', 'entity_relations', 'documents', 'document_entities'];

/**
 * @typedef {{ id: number, kind: string, name: string, key: string, brand: string|null, attrs: Record<string, unknown>,
 *   aliases: string[] }} EntitySnapshot
 * @typedef {{ id: number, role: string, direction: 'out'|'in', entity: { id: number, kind: string, name: string },
 *   attrs: Record<string, unknown> }} EntityRelationView
 * @typedef {EntitySnapshot & { relations: EntityRelationView[], documentCount: number, createdAt: string, updatedAt: string }} Entity
 * @typedef {{ id: number, from: number, to: number, role: string, attrs: Record<string, unknown> }} EntityRelation
 */

// ---------- validation helpers ----------

const invalid = (message, details) => new DossierError('INVALID_INPUT', message, details);
const notFound = (ref, kind) => new DossierError('ENTITY_NOT_FOUND', `No ${kind ?? 'entity'} matches "${ref}"`, { ref, ...(kind ? { kind } : {}) });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkKind(kind) {
  if (!ENTITY_KINDS.includes(kind)) throw invalid(`Unknown entity kind "${kind}" (expected one of ${ENTITY_KINDS.join(', ')})`, { kind });
  return kind;
}

function checkName(value, what) {
  if (typeof value !== 'string') throw invalid(`${what} must be a string`, { [what]: value });
  const key = normaliseName(value);
  if (!/[\p{L}\p{N}]/u.test(key)) throw invalid(`${what} "${value}" has no letters or digits`, { [what]: value });
  return { text: value.trim().replace(/\s+/gu, ' '), key };
}

function checkEntityId(value, what = 'id') {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n <= 0) throw invalid(`${what} must be a positive integer entity id`, { [what]: value });
  return n;
}

// ---------- row access ----------

const rowById = (ctx, id) => ctx.db.prepare('SELECT * FROM entities WHERE id = ?').get(id);

function aliasesOf(ctx, id) {
  return ctx.db.prepare('SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY rowid').all(id).map((r) => r.alias);
}

/** @returns {EntitySnapshot|null} */
function snapshot(ctx, id) {
  const row = rowById(ctx, id);
  if (!row) return null;
  return {
    id: row.id, kind: row.kind, name: row.display_name, key: row.canonical_key, brand: row.brand_id ?? null,
    attrs: JSON.parse(row.attrs), aliases: aliasesOf(ctx, id),
  };
}

/** Ids of entities whose canonical key or an alias key equals `key` (optionally of one kind). */
function idsByKey(ctx, key, kind) {
  return ctx.db.prepare(
    'SELECT id FROM entities WHERE canonical_key = :key AND (:kind IS NULL OR kind = :kind) '
    + 'UNION SELECT e.id FROM entity_aliases a JOIN entities e ON e.id = a.entity_id '
    + 'WHERE a.alias_key = :key AND (:kind IS NULL OR e.kind = :kind) ORDER BY id',
  ).all({ key, kind: kind ?? null }).map((r) => r.id);
}

/** The entity of `kind` owning `key` as its name or an alias, or null. Keys are unique per kind, so at most one. */
const ownerOf = (ctx, kind, key) => idsByKey(ctx, key, kind)[0] ?? null;

function duplicate(ctx, existingId, value, kind) {
  const other = rowById(ctx, existingId);
  return new DossierError('ENTITY_DUPLICATE',
    `"${value}" already names ${kind} "${other.display_name}" (id ${existingId}); pass aliasOf: ${existingId} to add it as an alias`,
    { existingId, kind, name: value });
}

/**
 * Resolve an entity reference to a row: a number (or digit string) is an id, anything else a name or alias.
 * @returns {object} entities row
 */
function resolveRow(ctx, ref, kind) {
  if (kind !== undefined && kind !== null) checkKind(kind);
  const numeric = typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref));
  if (numeric) {
    const row = rowById(ctx, Number(ref));
    if (row && (!kind || row.kind === kind)) return row;
    if (typeof ref === 'number') throw notFound(ref, kind);
  }
  if (typeof ref !== 'string') throw invalid('An entity reference must be an id or a name', { ref });
  const key = normaliseName(ref);
  const ids = key ? idsByKey(ctx, key, kind) : [];
  if (ids.length === 0) throw notFound(ref, kind);
  if (ids.length > 1) {
    const candidates = ids.map((id) => { const r = rowById(ctx, id); return { id, kind: r.kind, name: r.display_name }; });
    throw new DossierError('ENTITY_AMBIGUOUS', `"${ref}" names ${ids.length} entities of different kinds; pass a kind`, { ref, candidates });
  }
  return rowById(ctx, ids[0]);
}

function relationsOf(ctx, id) {
  return ctx.db.prepare(
    'SELECT r.id, r.role, r.attrs, r.from_id, e.id AS other_id, e.kind AS other_kind, e.display_name AS other_name '
    + 'FROM entity_relations r JOIN entities e ON e.id = CASE WHEN r.from_id = :id THEN r.to_id ELSE r.from_id END '
    + 'WHERE r.from_id = :id OR r.to_id = :id ORDER BY r.id',
  ).all({ id }).map((r) => ({
    id: r.id,
    role: r.role,
    direction: r.from_id === id ? 'out' : 'in',
    entity: { id: r.other_id, kind: r.other_kind, name: r.other_name },
    attrs: JSON.parse(r.attrs),
  }));
}

/**
 * Number of documents referencing each entity: as party, business line, engagement, issuing entity or any
 * document–entity role, each document counted once per entity (not filtered by clearance). One grouped query for
 * every id, so a list of 500 entities costs one statement; `getEntity().documentCount` uses the same query.
 * @param {object} ctx
 * @param {number[]} ids
 * @returns {Map<number, number>} entity id → count; ids without documents map to 0
 */
export function entityDocumentCounts(ctx, ids) {
  const counts = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0) return counts;
  const rows = ctx.db.prepare(
    'WITH ids(id) AS (SELECT value FROM json_each(:ids)), refs(entity_id, document_id) AS ('
    + 'SELECT entity_id, document_id FROM document_entities WHERE entity_id IN (SELECT id FROM ids) '
    + 'UNION SELECT party_id, id FROM documents WHERE party_id IN (SELECT id FROM ids) '
    + 'UNION SELECT business_line_id, id FROM documents WHERE business_line_id IN (SELECT id FROM ids) '
    + 'UNION SELECT engagement_id, id FROM documents WHERE engagement_id IN (SELECT id FROM ids) '
    + 'UNION SELECT issuing_entity_id, id FROM documents WHERE issuing_entity_id IN (SELECT id FROM ids)) '
    + 'SELECT entity_id, count(*) AS n FROM refs GROUP BY entity_id',
  ).all({ ids: JSON.stringify(ids) });
  for (const r of rows) counts.set(r.entity_id, r.n);
  return counts;
}

/** Documents referencing one entity (see entityDocumentCounts). */
export const entityDocumentCount = (ctx, id) => entityDocumentCounts(ctx, [id]).get(id) ?? 0;

function fullEntity(ctx, row) {
  return {
    ...snapshot(ctx, row.id),
    relations: relationsOf(ctx, row.id),
    documentCount: entityDocumentCount(ctx, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Insert aliases (skipping the canonical key and keys the entity already has); returns how many were added. */
function addAliases(ctx, id, names) {
  let added = 0;
  for (const { text, key } of names) {
    const row = rowById(ctx, id);
    if (key === row.canonical_key) continue;
    const r = ctx.db.prepare('INSERT INTO entity_aliases (entity_id, alias, alias_key) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(id, text, key);
    added += Number(r.changes);
  }
  return added;
}

/**
 * Audit, bump and emit when the entity's snapshot changed; returns true if it did. A changed name or alias list
 * reindexes the documents that show it (search index rows carry party names and aliases).
 */
function recordChange(ctx, id, before) {
  const after = snapshot(ctx, id);
  if (before && JSON.stringify(before) === JSON.stringify(after)) return false;
  ctx.db.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  ctx.repo.audit(before ? 'entity.update' : 'entity.create', 'entity', id, before, after);
  if (before && (before.name !== after.name || JSON.stringify(before.aliases) !== JSON.stringify(after.aliases))) {
    if (reindexEntityDocuments(ctx, id) > 0) ctx.repo.bump('search_index');
  }
  ctx.repo.bump('entities');
  ctx.repo.emitAfterCommit(ENTITY_CHANGED, { ids: [id] });
  return true;
}

// ---------- public API ----------

/**
 * Create or update an entity of the master list.
 *
 * - With `id`: update that entity. A new name whose key differs renames it and keeps the old name as an alias.
 *   `kind` may be omitted but cannot change.
 * - Without `id`: update the entity of `kind` whose canonical key equals the normalised `name` (its display name is
 *   kept), or create one.
 * - `aliases` are added (never removed); `attrs` are shallow-merged (a `null` value deletes the key); `brand` sets the
 *   brand link (`null` clears it).
 * - If the name or an alias already belongs to another entity of the same kind (as name or alias), throws
 *   `DossierError('ENTITY_DUPLICATE', …, { existingId })`, unless `aliasOf` names that entity: then `name` and
 *   `aliases` are added as aliases of the `aliasOf` entity (an id, or a name/alias of the same kind) and nothing is
 *   created. `aliasOf` cannot be combined with `id`, `attrs` or `brand`.
 *
 * Writes run in one `ctx.repo.tx` with an `entity.create`/`entity.update` audit row and an after-commit
 * `entity:changed` event; an upsert that changes nothing writes nothing.
 * @param {object} ctx context from openContext
 * @param {{ id?: number, kind?: string, name: string, aliases?: string[], attrs?: Record<string, unknown>,
 *   brand?: string|null, aliasOf?: number|string }} input
 * @returns {Entity}
 */
export function upsertEntity(ctx, input) {
  if (!isPlainObject(input)) throw invalid('upsertEntity expects an object');
  const { id: rawId, kind, name, aliases = [], attrs, brand, aliasOf } = input;
  const id = rawId === undefined || rawId === null ? null : checkEntityId(rawId);
  if (id === null || kind !== undefined) checkKind(kind);
  const main = checkName(name, 'name');
  if (!Array.isArray(aliases)) throw invalid('aliases must be an array of strings', { aliases });
  const extra = aliases.map((a) => checkName(a, 'alias'));
  if (attrs !== undefined && !isPlainObject(attrs)) throw invalid('attrs must be an object', { attrs });
  if (brand !== undefined && brand !== null) {
    if (typeof brand !== 'string' || !ctx.db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brand)) {
      throw invalid(`Unknown brand "${brand}"`, { brand });
    }
  }
  const hasAliasOf = aliasOf !== undefined && aliasOf !== null;
  if (hasAliasOf && (id !== null || attrs !== undefined || brand !== undefined)) {
    throw invalid('aliasOf cannot be combined with id, attrs or brand');
  }

  return ctx.repo.tx(() => {
    // -- aliasOf: everything becomes an alias of the target
    if (hasAliasOf) {
      // A name is looked up within the entity's kind (the same name may belong to entities of other kinds); a numeric
      // id is resolved as is so a wrong kind is reported as such.
      const target = resolveRow(ctx, aliasOf, typeof aliasOf === 'number' ? undefined : kind);
      if (target.kind !== kind) throw invalid(`aliasOf names a ${target.kind}, not a ${kind}`, { aliasOf, kind });
      for (const n of [main, ...extra]) {
        const owner = ownerOf(ctx, kind, n.key);
        if (owner !== null && owner !== target.id) throw duplicate(ctx, owner, n.text, kind);
      }
      const before = snapshot(ctx, target.id);
      addAliases(ctx, target.id, [main, ...extra]);
      recordChange(ctx, target.id, before);
      return fullEntity(ctx, rowById(ctx, target.id));
    }

    // -- find the row to update (or none)
    let row = null;
    if (id !== null) {
      row = rowById(ctx, id);
      if (!row) throw notFound(id);
      if (kind !== undefined && kind !== row.kind) throw invalid(`Entity ${id} is a ${row.kind}; its kind cannot change to ${kind}`, { id, kind });
      const owner = ownerOf(ctx, row.kind, main.key);
      if (owner !== null && owner !== id) throw duplicate(ctx, owner, main.text, row.kind);
    } else {
      const owner = ownerOf(ctx, kind, main.key);
      if (owner !== null) {
        const candidate = rowById(ctx, owner);
        if (candidate.canonical_key !== main.key) throw duplicate(ctx, owner, main.text, kind);
        row = candidate;
      }
    }
    const entityKind = row ? row.kind : kind;
    for (const n of extra) {
      const owner = ownerOf(ctx, entityKind, n.key);
      if (owner !== null && owner !== row?.id) throw duplicate(ctx, owner, n.text, entityKind);
    }

    // -- create
    if (!row) {
      const merged = mergeAttrs({}, attrs);
      const r = ctx.db.prepare(
        'INSERT INTO entities (kind, canonical_key, display_name, brand_id, attrs) VALUES (?, ?, ?, ?, ?)',
      ).run(kind, main.key, main.text, brand ?? null, JSON.stringify(merged));
      const newId = Number(r.lastInsertRowid);
      addAliases(ctx, newId, extra);
      recordChange(ctx, newId, null);
      return fullEntity(ctx, rowById(ctx, newId));
    }

    // -- update
    const before = snapshot(ctx, row.id);
    if (id !== null && main.text !== row.display_name) {
      if (main.key !== row.canonical_key) {
        ctx.db.prepare('DELETE FROM entity_aliases WHERE entity_id = ? AND alias_key = ?').run(row.id, main.key);
        ctx.db.prepare('INSERT INTO entity_aliases (entity_id, alias, alias_key) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
          .run(row.id, row.display_name, row.canonical_key);
      }
      ctx.db.prepare('UPDATE entities SET canonical_key = ?, display_name = ? WHERE id = ?').run(main.key, main.text, row.id);
    }
    if (attrs !== undefined) {
      ctx.db.prepare('UPDATE entities SET attrs = ? WHERE id = ?').run(JSON.stringify(mergeAttrs(before.attrs, attrs)), row.id);
    }
    if (brand !== undefined) ctx.db.prepare('UPDATE entities SET brand_id = ? WHERE id = ?').run(brand, row.id);
    addAliases(ctx, row.id, extra);
    recordChange(ctx, row.id, before);
    return fullEntity(ctx, rowById(ctx, row.id));
  });
}

function mergeAttrs(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * Fetch one entity with its aliases, relations in both directions and the number of documents referencing it
 * (as party, business line, engagement, issuing entity or any document–entity role).
 * @param {object} ctx
 * @param {number|string} idOrName an id (number or digit string) or a name/alias (normalised before lookup)
 * @param {{ kind?: string }} [opts] restrict a name lookup to one kind
 * @returns {Entity} throws ENTITY_NOT_FOUND, or ENTITY_AMBIGUOUS when a name matches entities of several kinds
 */
export function getEntity(ctx, idOrName, { kind } = {}) {
  const key = `entity\u0000${typeof idOrName}\u0000${String(idOrName)}\u0000${kind ?? ''}`;
  return structuredClone(memoOf(ctx)(key, ENTITY_DEPS, () => fullEntity(ctx, resolveRow(ctx, idOrName, kind))));
}

/**
 * Search the master list: substring match of the normalised query against canonical keys and alias keys.
 * Exact matches rank first, then prefix matches, then the rest, each by canonical key.
 * An empty (or punctuation-only) query lists everything.
 * @param {object} ctx
 * @param {{ q?: string, kind?: string, limit?: number }} [opts] limit 1..500, default 50
 * @returns {{ id: number, kind: string, name: string, brand: string|null, aliases: string[], matched: string|null }[]}
 *   `matched` is the alias that matched when the canonical name did not match exactly (null otherwise)
 */
export function findEntities(ctx, { q = '', kind, limit = 50 } = {}) {
  if (kind !== undefined && kind !== null) checkKind(kind);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw invalid(`limit must be an integer from 1 to ${MAX_LIMIT}`, { limit });
  const memoKey = `entities\u0000${JSON.stringify([q, kind ?? null, limit])}`;
  return structuredClone(memoOf(ctx)(memoKey, ['entities'], () => matchEntities(ctx, q, kind, limit)));
}

function matchEntities(ctx, q, kind, limit) {
  const key = normaliseName(q);
  const esc = key.replace(/[\\%_]/g, (c) => `\\${c}`);
  const aliasLike = (p) => `EXISTS (SELECT 1 FROM entity_aliases a WHERE a.entity_id = e.id AND a.alias_key LIKE ${p} ESCAPE '\\')`;
  const rows = ctx.db.prepare(
    'SELECT e.id, e.kind, e.display_name, e.canonical_key, e.brand_id, '
    + "CASE WHEN :key = '' THEN 2 "
    + 'WHEN e.canonical_key = :key OR EXISTS (SELECT 1 FROM entity_aliases a WHERE a.entity_id = e.id AND a.alias_key = :key) THEN 0 '
    + `WHEN e.canonical_key LIKE :prefix ESCAPE '\\' OR ${aliasLike(':prefix')} THEN 1 ELSE 2 END AS rank `
    + 'FROM entities e WHERE (:kind IS NULL OR e.kind = :kind) '
    + `AND (:key = '' OR e.canonical_key LIKE :like ESCAPE '\\' OR ${aliasLike(':like')}) `
    + 'ORDER BY rank, e.canonical_key, e.id LIMIT :limit',
  ).all({ key, prefix: `${esc}%`, like: `%${esc}%`, kind: kind ?? null, limit });
  const aliasStmt = ctx.db.prepare('SELECT alias, alias_key FROM entity_aliases WHERE entity_id = ? ORDER BY rowid');
  return rows.map((r) => {
    const aliases = aliasStmt.all(r.id);
    let matched = null;
    if (key && r.canonical_key !== key) {
      const hit = aliases.find((a) => a.alias_key === key)
        ?? (r.canonical_key.includes(key) ? null : aliases.find((a) => a.alias_key.includes(key)));
      matched = hit?.alias ?? null;
    }
    return { id: r.id, kind: r.kind, name: r.display_name, brand: r.brand_id ?? null, aliases: aliases.map((a) => a.alias), matched };
  });
}

const relationRow = (ctx, from, to, role) => ctx.db.prepare('SELECT * FROM entity_relations WHERE from_id = ? AND to_id = ? AND role = ?').get(from, to, role);
const relationView = (r) => ({ id: r.id, from: r.from_id, to: r.to_id, role: r.role, attrs: JSON.parse(r.attrs) });

function checkRelation(ctx, fromId, toId, role) {
  const from = checkEntityId(fromId, 'fromId');
  const to = checkEntityId(toId, 'toId');
  if (!ENTITY_RELATION_ROLES.includes(role)) throw invalid(`Unknown relation role "${role}" (expected one of ${ENTITY_RELATION_ROLES.join(', ')})`, { role });
  if (from === to) throw invalid('An entity cannot be related to itself', { fromId, toId });
  for (const id of [from, to]) if (!rowById(ctx, id)) throw notFound(id);
  return { from, to };
}

/**
 * Relate two entities (`from` --role--> `to`, e.g. person employed_by company). Relating an existing pair again is a
 * no-op unless `attrs` is given and differs, which replaces the relation's attrs. Audited as `entity.relate`.
 * @param {object} ctx
 * @param {number} fromId
 * @param {number} toId
 * @param {string} role one of the entity relation roles
 * @param {Record<string, unknown>} [attrs]
 * @returns {EntityRelation}
 */
export function relateEntities(ctx, fromId, toId, role, attrs) {
  if (attrs !== undefined && !isPlainObject(attrs)) throw invalid('attrs must be an object', { attrs });
  return ctx.repo.tx(() => {
    const { from, to } = checkRelation(ctx, fromId, toId, role);
    const existing = relationRow(ctx, from, to, role);
    const json = JSON.stringify(attrs ?? {});
    if (existing && (attrs === undefined || existing.attrs === json)) return relationView(existing);
    let row;
    if (existing) {
      ctx.db.prepare('UPDATE entity_relations SET attrs = ? WHERE id = ?').run(json, existing.id);
      row = relationRow(ctx, from, to, role);
    } else {
      ctx.db.prepare('INSERT INTO entity_relations (from_id, to_id, role, attrs) VALUES (?, ?, ?, ?)').run(from, to, role, json);
      row = relationRow(ctx, from, to, role);
    }
    ctx.repo.audit('entity.relate', 'entity_relation', row.id, existing ? relationView(existing) : null, relationView(row));
    ctx.repo.bump('entity_relations');
    ctx.repo.emitAfterCommit(ENTITY_CHANGED, { ids: [from, to] });
    return relationView(row);
  });
}

/**
 * Remove the relation `from` --role--> `to`. Audited as `entity.unrelate`.
 * @param {object} ctx
 * @param {number} fromId
 * @param {number} toId
 * @param {string} role
 * @returns {boolean} true if a relation was removed
 */
export function unrelateEntities(ctx, fromId, toId, role) {
  return ctx.repo.tx(() => {
    const { from, to } = checkRelation(ctx, fromId, toId, role);
    const existing = relationRow(ctx, from, to, role);
    if (!existing) return false;
    ctx.db.prepare('DELETE FROM entity_relations WHERE id = ?').run(existing.id);
    ctx.repo.audit('entity.unrelate', 'entity_relation', existing.id, relationView(existing), null);
    ctx.repo.bump('entity_relations');
    ctx.repo.emitAfterCommit(ENTITY_CHANGED, { ids: [from, to] });
    return true;
  });
}

/**
 * Load `seeds/entities.json` content idempotently, in one transaction. Seeds are matched to existing entities by
 * kind + name or alias (so renamed entities are still found). Missing entities and relations are created and missing
 * aliases added; existing names, attrs and brand links are never overwritten, so user edits survive a re-seed.
 * Seeding the same content twice writes nothing.
 * @param {object} ctx
 * @param {{ entities?: object[], relations?: object[] }} [seeds] defaults to `ctx.ws.seeds`
 * @returns {{ entitiesCreated: number, entitiesUpdated: number, aliasesAdded: number, relationsCreated: number }}
 */
export function seedEntities(ctx, seeds = ctx.ws.seeds) {
  const parsed = SeedsSchema.safeParse(seeds ?? {});
  if (!parsed.success) throw invalid(`Invalid seeds:\n${formatIssues(parsed.error)}`);
  const { entities, relations } = parsed.data;
  const stats = { entitiesCreated: 0, entitiesUpdated: 0, aliasesAdded: 0, relationsCreated: 0 };
  const find = (kind, name) => ownerOf(ctx, kind, normaliseName(name));

  ctx.repo.tx(() => {
    for (const e of entities) {
      const existing = find(e.kind, e.name);
      if (existing === null) {
        upsertEntity(ctx, { kind: e.kind, name: e.name, aliases: e.aliases, attrs: e.attrs, ...(e.brand ? { brand: e.brand } : {}) });
        stats.entitiesCreated++;
        continue;
      }
      const missing = [];
      const keys = new Set();
      for (const alias of e.aliases) {
        const key = normaliseName(alias);
        if (keys.has(key) || find(e.kind, alias) === existing) continue;
        keys.add(key);
        missing.push(alias);
      }
      if (missing.length === 0) continue;
      const row = rowById(ctx, existing);
      upsertEntity(ctx, { id: existing, name: row.display_name, aliases: missing });
      stats.entitiesUpdated++;
      stats.aliasesAdded += missing.length;
    }
    for (const r of relations) {
      const from = find(r.from.kind, r.from.name);
      const to = find(r.to.kind, r.to.name);
      if (from === null) throw notFound(r.from.name, r.from.kind);
      if (to === null) throw notFound(r.to.name, r.to.kind);
      if (relationRow(ctx, from, to, r.role)) continue;
      relateEntities(ctx, from, to, r.role);
      stats.relationsCreated++;
    }
  });
  return stats;
}
