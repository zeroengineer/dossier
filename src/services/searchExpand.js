/**
 * One-hop expansion for search (docs/PLAN.md B6.2): documents linked to the hits by a document relation (either
 * direction) and documents of the matched entities (as party, signatory or named). Every query is restricted by the
 * caller's filter SQL, which carries the sensitivity check.
 */

/** Document–entity roles that pull a document into the results of an entity match. */
export const EXPAND_ROLES = Object.freeze(['party', 'signatory', 'named']);

/**
 * @typedef {{ sql: string, params: Record<string, unknown> }} DocFilter SQL over alias `d` (documents) plus its
 *   named parameters
 * @typedef {{ row: object, via: { kind: 'entity'|'document', relation: string, from: string|number } }} RelatedRow
 */

/**
 * Documents one relation away from each hit, in hit order, then relation id order. Template targets are skipped.
 * @param {object} ctx
 * @param {string[]} hitIds
 * @param {DocFilter} filter
 * @returns {Generator<RelatedRow>} rows are read lazily, so a caller that stops early stops the query
 */
function* viaDocuments(ctx, hitIds, filter) {
  const stmt = ctx.db.prepare(
    'SELECT d.*, x.type AS via_type FROM ('
    + 'SELECT id, to_doc AS other, type FROM document_relations WHERE from_doc = :hit '
    + 'UNION ALL SELECT id, from_doc AS other, type FROM document_relations WHERE to_doc = :hit'
    + `) x JOIN documents d ON d.id = x.other WHERE ${filter.sql} ORDER BY x.id`,
  );
  for (const hit of hitIds) {
    for (const row of stmt.iterate({ ...filter.params, hit })) {
      yield { row, via: { kind: 'document', relation: row.via_type, from: hit } };
    }
  }
}

/**
 * Documents of each entity in an expansion role, newest document date first.
 * @param {object} ctx
 * @param {number[]} entityIds
 * @param {DocFilter} filter
 * @returns {Generator<RelatedRow>} rows are read lazily, so a caller that stops early stops the query
 */
function* viaEntities(ctx, entityIds, filter) {
  const stmt = ctx.db.prepare(
    'SELECT d.*, x.role AS via_role FROM ('
    + "SELECT id AS doc, 'party' AS role, 0 AS ord FROM documents WHERE party_id = :entity "
    + 'UNION SELECT document_id, role, CASE role '
    + EXPAND_ROLES.map((r, i) => `WHEN '${r}' THEN ${i}`).join(' ')
    + ` END FROM document_entities WHERE entity_id = :entity AND role IN (${EXPAND_ROLES.map((r) => `'${r}'`).join(', ')})`
    + `) x JOIN documents d ON d.id = x.doc WHERE ${filter.sql} `
    + 'ORDER BY d.doc_date IS NULL, d.doc_date DESC, d.id DESC, x.ord',
  );
  for (const entity of entityIds) {
    for (const row of stmt.iterate({ ...filter.params, entity })) {
      yield { row, via: { kind: 'entity', relation: row.via_role, from: entity } };
    }
  }
}

/**
 * Related documents for a result set: first those linked to the hits (in hit order), then those of the matched
 * entities. A document already among the hits is left out; each document appears once, with the first way it
 * was reached.
 * @param {object} ctx
 * @param {{ hitIds: string[], entityIds: number[], filter: DocFilter, limit: number }} opts
 * @returns {RelatedRow[]}
 */
export function expandRelated(ctx, { hitIds, entityIds, filter, limit }) {
  const seen = new Set(hitIds);
  const out = [];
  // Both sources are lazy: reading stops as soon as `limit` documents are collected.
  for (const r of chain(viaDocuments(ctx, hitIds, filter), viaEntities(ctx, entityIds, filter))) {
    if (seen.has(r.row.id)) continue;
    seen.add(r.row.id);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

function* chain(...sources) {
  for (const source of sources) yield* source;
}
