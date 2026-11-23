-- 002_search: full-text index over documents (docs/PLAN.md B6).
-- One row per document, rowid = the numeric part of its id (DOC-000123 -> 123), maintained by
-- src/services/searchIndex.js inside the same transaction as the write that changed the document.
-- title: title + type; number: document number + id; parties: party names and aliases; body: current version text.
-- Rows are filled by reindexAll when this migration is first applied (see src/context.js).

CREATE VIRTUAL TABLE search_index USING fts5(
  doc_id UNINDEXED,
  title,
  number,
  parties,
  body,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER documents_delete_search AFTER DELETE ON documents
BEGIN
  DELETE FROM search_index WHERE rowid = CAST(substr(OLD.id, 5) AS INTEGER);
END;
