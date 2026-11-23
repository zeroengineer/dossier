/**
 * Maintenance of the `search_index` FTS5 table (migration 002). Writers call `reindexDocument` inside the
 * transaction that changed the document, so the index commits or rolls back with the write.
 */

/** FTS rowid of a document: the numeric part of `DOC-000123`. */
const rowidOf = (docId) => Number(docId.slice(4));

/** Party entities of a document: `documents.party_id` plus document_entities rows with role `party`. */
const PARTY_IDS_SQL = 'SELECT party_id AS id FROM documents WHERE id = :id AND party_id IS NOT NULL '
  + "UNION SELECT entity_id FROM document_entities WHERE document_id = :id AND role = 'party'";

/** Names and aliases of the document's parties, one per line. */
function partyText(ctx, docId) {
  const rows = ctx.db.prepare(
    `SELECT e.display_name AS name FROM entities e WHERE e.id IN (${PARTY_IDS_SQL}) `
    + `UNION ALL SELECT a.alias FROM entity_aliases a WHERE a.entity_id IN (${PARTY_IDS_SQL})`,
  ).all({ id: docId });
  return rows.map((r) => r.name).join('\n');
}

/** Extracted text of every rendition of the current version, identical texts once. */
function bodyText(ctx, currentVersionId) {
  if (currentVersionId === null) return '';
  const rows = ctx.db.prepare(
    'SELECT t.text FROM renditions r JOIN document_text t ON t.rendition_id = r.id WHERE r.version_id = ? ORDER BY r.id',
  ).all(currentVersionId);
  return [...new Set(rows.map((r) => r.text.trim()).filter(Boolean))].join('\n\n');
}

/**
 * Rewrite the index row of one document from its current metadata, parties and current-version text (removing
 * the row when the document no longer exists). No access check: the index covers every document and search
 * filters by sensitivity. Call it inside the writer's transaction.
 * @param {object} ctx
 * @param {string} docId `DOC-000001`
 */
export function reindexDocument(ctx, docId) {
  if (typeof docId !== 'string' || !/^DOC-\d{6,}$/.test(docId)) return;
  const rowid = rowidOf(docId);
  ctx.db.prepare('DELETE FROM search_index WHERE rowid = ?').run(rowid);
  const doc = ctx.db.prepare('SELECT id, type, title, doc_number, current_version_id FROM documents WHERE id = ?').get(docId);
  if (!doc) return;
  ctx.db.prepare('INSERT INTO search_index (rowid, doc_id, title, number, parties, body) VALUES (?, ?, ?, ?, ?, ?)').run(
    rowid, doc.id, [doc.title, doc.type].filter(Boolean).join('\n'), [doc.doc_number, doc.id].filter(Boolean).join('\n'),
    partyText(ctx, doc.id), bodyText(ctx, doc.current_version_id),
  );
}

/**
 * Reindex every document whose index row shows `entityId`'s names: documents with it as party
 * (`documents.party_id`) or linked through `document_entities`. Used after an entity rename or alias change.
 * @param {object} ctx
 * @param {number} entityId
 * @returns {number} documents reindexed
 */
export function reindexEntityDocuments(ctx, entityId) {
  const ids = ctx.db.prepare(
    'SELECT id FROM documents WHERE party_id = :e UNION SELECT document_id FROM document_entities WHERE entity_id = :e',
  ).all({ e: entityId }).map((r) => r.id);
  for (const id of ids) reindexDocument(ctx, id);
  return ids.length;
}

/**
 * Rebuild the whole index in one transaction (`dossier reindex`).
 * @param {object} ctx
 * @returns {{ documents: number }}
 */
export function reindexAll(ctx) {
  return ctx.repo.tx(() => {
    ctx.db.exec('DELETE FROM search_index');
    const ids = ctx.db.prepare('SELECT id FROM documents ORDER BY id').all().map((r) => r.id);
    for (const id of ids) reindexDocument(ctx, id);
    ctx.repo.bump('search_index');
    return { documents: ids.length };
  });
}
