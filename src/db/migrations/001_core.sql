-- 001_core: core vault schema (docs/PLAN.md B2, B4).
-- Timestamps are TEXT ISO-8601 UTC ('YYYY-MM-DDTHH:MM:SS.sssZ'); dates are TEXT 'YYYY-MM-DD'.
-- JSON columns hold text validated with json_valid(). Money is integer minor units + ISO currency code.

CREATE TABLE brands (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  loaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE entities (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('company','group_entity','person','client','vendor','product','business_line','engagement','financial_year')),
  canonical_key TEXT NOT NULL CHECK (canonical_key <> ''),
  display_name  TEXT NOT NULL CHECK (display_name <> ''),
  brand_id      TEXT REFERENCES brands(id),
  attrs         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attrs)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, canonical_key)
);
CREATE INDEX entities_brand ON entities(brand_id) WHERE brand_id IS NOT NULL;

CREATE TABLE entity_aliases (
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL CHECK (alias <> ''),
  alias_key TEXT NOT NULL CHECK (alias_key <> ''),
  PRIMARY KEY (entity_id, alias_key)
);
CREATE INDEX entity_aliases_key ON entity_aliases(alias_key);

CREATE TABLE entity_relations (
  id         INTEGER PRIMARY KEY,
  from_id    INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('employed_by','director_of','belongs_to_business_line','engagement_of','vendor_of','product_of','group_entity_of','signatory_of','contact_of')),
  attrs      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attrs)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_id <> to_id),
  UNIQUE (from_id, to_id, role)
);
CREATE INDEX entity_relations_to ON entity_relations(to_id, role);

CREATE TABLE documents (
  id                 TEXT PRIMARY KEY CHECK (id GLOB 'DOC-[0-9][0-9][0-9][0-9][0-9][0-9]*'),
  type               TEXT NOT NULL CHECK (type <> ''),
  title              TEXT NOT NULL DEFAULT '',
  party_id           INTEGER REFERENCES entities(id),
  party_type         TEXT CHECK (party_type IN ('Company','GroupEntity','Person','Client','Vendor','Product')),
  business_line_id   INTEGER REFERENCES entities(id),
  engagement_id      INTEGER REFERENCES entities(id),
  issuing_entity_id  INTEGER REFERENCES entities(id),
  issuing_brand_id   TEXT REFERENCES brands(id),
  number_series      TEXT,
  doc_number         TEXT,
  number_conflict    INTEGER NOT NULL DEFAULT 0 CHECK (number_conflict IN (0, 1)),
  doc_date           TEXT,
  due_date           TEXT,
  amount_minor       INTEGER CHECK (amount_minor IS NULL OR typeof(amount_minor) = 'integer'),
  currency           TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency = upper(currency))),
  status             TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Sent','Signed','Paid','Superseded')),
  sensitivity        TEXT NOT NULL DEFAULT 'Internal' CHECK (sensitivity IN ('Public','Internal','Confidential','Restricted')),
  current_version_id INTEGER REFERENCES versions(id),
  template_id        TEXT,
  template_version   INTEGER,
  created_by         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (amount_minor IS NULL OR currency IS NOT NULL),
  CHECK (party_id IS NULL OR party_type IS NOT NULL)
);
-- Rule B5.3: numbers are unique per series unless the row is flagged as a known conflict.
CREATE UNIQUE INDEX documents_series_number ON documents(number_series, doc_number)
  WHERE number_conflict = 0 AND doc_number IS NOT NULL;
CREATE INDEX documents_number ON documents(doc_number) WHERE doc_number IS NOT NULL;
CREATE INDEX documents_party ON documents(party_id);
CREATE INDEX documents_engagement ON documents(engagement_id);
CREATE INDEX documents_business_line ON documents(business_line_id);
CREATE INDEX documents_type_date ON documents(type, doc_date);

CREATE TABLE versions (
  id          INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no  INTEGER NOT NULL CHECK (version_no >= 1),
  is_current  INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  note        TEXT,
  input_json  TEXT CHECK (input_json IS NULL OR json_valid(input_json)),
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (document_id, version_no)
);
-- Rule B5.2: at most one current version per document.
CREATE UNIQUE INDEX versions_one_current ON versions(document_id) WHERE is_current = 1;

CREATE TABLE blobs (
  sha256        TEXT PRIMARY KEY CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  bytes         INTEGER NOT NULL CHECK (bytes >= 0),
  mime          TEXT,
  stored_path   TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE renditions (
  id          INTEGER PRIMARY KEY,
  version_id  INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('pdf','html','md','original')),
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL CHECK (bytes >= 0),
  page_count  INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (version_id, kind)
);
CREATE INDEX renditions_blob ON renditions(blob_sha256);

CREATE TABLE document_text (
  rendition_id INTEGER PRIMARY KEY REFERENCES renditions(id) ON DELETE CASCADE,
  text         TEXT NOT NULL
);

-- to_doc is a document id, except for 'generated_from' where it names a template as 'template:<id>@<version>'.
-- That is why to_doc has no foreign key; the triggers below enforce the same rule for document targets.
CREATE TABLE document_relations (
  id         INTEGER PRIMARY KEY,
  from_doc   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  to_doc     TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('based_on','pays','settles','adjusts','follows','generated_from','supersedes','rendition_of')),
  attrs      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attrs)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_doc <> to_doc),
  CHECK ((type = 'generated_from') = (to_doc GLOB 'template:*')),
  UNIQUE (from_doc, to_doc, type)
);
CREATE INDEX document_relations_to ON document_relations(to_doc);

CREATE TRIGGER document_relations_target_insert BEFORE INSERT ON document_relations
WHEN NEW.type <> 'generated_from' AND NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.to_doc)
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: document_relations.to_doc');
END;

CREATE TRIGGER document_relations_target_update BEFORE UPDATE OF to_doc, type ON document_relations
WHEN NEW.type <> 'generated_from' AND NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.to_doc)
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: document_relations.to_doc');
END;

CREATE TRIGGER documents_delete_relations AFTER DELETE ON documents
BEGIN
  DELETE FROM document_relations WHERE to_doc = OLD.id;
END;

CREATE TABLE document_entities (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('party','signatory','named','contact','issuer')),
  PRIMARY KEY (document_id, entity_id, role)
);
CREATE INDEX document_entities_entity ON document_entities(entity_id, role);

CREATE TABLE templates (
  id        TEXT NOT NULL,
  version   INTEGER NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('builtin','workspace')),
  path      TEXT,
  hash      TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta_json)),
  loaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id, version)
);

CREATE TABLE sequences (
  scope_key TEXT PRIMARY KEY,
  next      INTEGER NOT NULL CHECK (next >= 0)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id   TEXT,
  before      TEXT CHECK (before IS NULL OR json_valid(before)),
  after       TEXT CHECK (after IS NULL OR json_valid(after))
);
CREATE INDEX audit_log_target ON audit_log(target_kind, target_id);
CREATE INDEX audit_log_at ON audit_log(at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
