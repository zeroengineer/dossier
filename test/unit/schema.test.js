import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../../src/db/index.js';

const SHA = 'a'.repeat(64);

function fresh() {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare("INSERT INTO brands (id, name, config_hash) VALUES ('acme', 'Acme Events Private Limited', 'h')").run();
  return db;
}

const run = (db, sql, ...args) => db.prepare(sql).run(...args);
const rejects = (fn, re = /CHECK constraint failed/) => assert.throws(fn, re);

function addEntity(db, kind = 'client', key = 'example client', name = 'Example Client') {
  return Number(run(db, 'INSERT INTO entities (kind, canonical_key, display_name) VALUES (?, ?, ?)', kind, key, name).lastInsertRowid);
}
function addDoc(db, id = 'DOC-000001', extra = {}) {
  const cols = { id, type: 'invoice', ...extra };
  const keys = Object.keys(cols);
  run(db, `INSERT INTO documents (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...Object.values(cols));
  return id;
}

test('migration creates every table from PLAN B2', () => {
  const db = fresh();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['brands', 'entities', 'entity_aliases', 'entity_relations', 'documents', 'versions', 'renditions', 'blobs',
    'document_text', 'document_relations', 'document_entities', 'templates', 'sequences', 'audit_log', 'settings', 'schema_migrations']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  db.close();
});

test('entity kind and relation role CHECKs; (kind, canonical_key) unique', () => {
  const db = fresh();
  rejects(() => addEntity(db, 'customer'));
  const a = addEntity(db, 'client', 'example client');
  assert.throws(() => addEntity(db, 'client', 'example client'), /UNIQUE constraint failed/);
  addEntity(db, 'vendor', 'example client'); // same key, other kind: fine
  const p = addEntity(db, 'person', 'jordan placeholder', 'Jordan Placeholder');
  rejects(() => run(db, "INSERT INTO entities (kind, canonical_key, display_name, attrs) VALUES ('person', 'x', 'X', 'not json')"));
  rejects(() => run(db, "INSERT INTO entity_relations (from_id, to_id, role) VALUES (?, ?, 'friend_of')", p, a));
  run(db, "INSERT INTO entity_relations (from_id, to_id, role) VALUES (?, ?, 'contact_of')", p, a);
  assert.throws(() => run(db, "INSERT INTO entity_relations (from_id, to_id, role) VALUES (?, ?, 'contact_of')", p, a), /UNIQUE/);
  rejects(() => run(db, "INSERT INTO entity_relations (from_id, to_id, role) VALUES (?, ?, 'contact_of')", p, p));
  db.close();
});

test('document status, sensitivity, party_type CHECKs and id format', () => {
  const db = fresh();
  rejects(() => addDoc(db, 'DOC-000001', { status: 'Archived' }));
  rejects(() => addDoc(db, 'DOC-000001', { sensitivity: 'Secret' }));
  const e = addEntity(db);
  rejects(() => addDoc(db, 'DOC-000001', { party_id: e, party_type: 'Customer' }));
  rejects(() => addDoc(db, 'DOC-000001', { party_id: e })); // party needs a party type
  rejects(() => addDoc(db, 'DOC-1'));
  rejects(() => addDoc(db, 'DOC-000001', { amount_minor: 1000 })); // amount needs currency
  rejects(() => addDoc(db, 'DOC-000001', { amount_minor: 10.5, currency: 'INR' }));
  rejects(() => addDoc(db, 'DOC-000001', { amount_minor: 1000, currency: 'inr' }));
  addDoc(db, 'DOC-000001', { party_id: e, party_type: 'Client', amount_minor: 118000, currency: 'INR', issuing_brand_id: 'acme' });
  const row = db.prepare('SELECT * FROM documents').get();
  assert.equal(row.status, 'Draft');
  assert.equal(row.sensitivity, 'Internal');
  assert.equal(row.number_conflict, 0);
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.throws(() => addDoc(db, 'DOC-000002', { issuing_brand_id: 'nope' }), /FOREIGN KEY/);
  db.close();
});

test('document numbers are unique per series unless flagged as a conflict', () => {
  const db = fresh();
  addDoc(db, 'DOC-000001', { number_series: 'invoice', doc_number: 'A/0131' });
  assert.throws(() => addDoc(db, 'DOC-000002', { number_series: 'invoice', doc_number: 'A/0131' }), /UNIQUE/);
  addDoc(db, 'DOC-000002', { number_series: 'invoice', doc_number: 'A/0131', number_conflict: 1 });
  addDoc(db, 'DOC-000003', { number_series: 'receipt', doc_number: 'A/0131' });
  addDoc(db, 'DOC-000004', { number_series: 'invoice' });
  addDoc(db, 'DOC-000005', { number_series: 'invoice' });
  rejects(() => addDoc(db, 'DOC-000006', { number_conflict: 2 }));
  db.close();
});

test('versions: unique version_no, one current version per document', () => {
  const db = fresh();
  addDoc(db);
  const ins = (no, cur) => Number(run(db, 'INSERT INTO versions (document_id, version_no, is_current, input_json) VALUES (?, ?, ?, ?)', 'DOC-000001', no, cur, '{"a":1}').lastInsertRowid);
  const v1 = ins(1, 1);
  assert.throws(() => ins(1, 0), /UNIQUE/);
  assert.throws(() => ins(2, 1), /UNIQUE/);
  const v2 = ins(2, 0);
  db.withTx(() => {
    run(db, 'UPDATE versions SET is_current = 0 WHERE id = ?', v1);
    run(db, 'UPDATE versions SET is_current = 1 WHERE id = ?', v2);
    run(db, 'UPDATE documents SET current_version_id = ? WHERE id = ?', v2, 'DOC-000001');
  });
  rejects(() => ins(0, 0));
  rejects(() => run(db, "INSERT INTO versions (document_id, version_no, input_json) VALUES ('DOC-000001', 9, 'nope')"));
  assert.throws(() => run(db, "INSERT INTO versions (document_id, version_no) VALUES ('DOC-000099', 1)"), /FOREIGN KEY/);
  db.close();
});

test('renditions, blobs and document_text', () => {
  const db = fresh();
  addDoc(db);
  const v = Number(run(db, "INSERT INTO versions (document_id, version_no, is_current) VALUES ('DOC-000001', 1, 1)").lastInsertRowid);
  rejects(() => run(db, "INSERT INTO blobs (sha256, bytes, stored_path) VALUES ('xyz', 1, 'p')"));
  run(db, 'INSERT INTO blobs (sha256, bytes, mime, stored_path) VALUES (?, 10, ?, ?)', SHA, 'application/pdf', `aa/${SHA}`);
  const rend = (kind) => run(db, 'INSERT INTO renditions (version_id, kind, blob_sha256, filename, mime, bytes, page_count) VALUES (?, ?, ?, ?, ?, ?, ?)', v, kind, SHA, 'f', 'application/pdf', 10, 1);
  rejects(() => rend('docx'));
  const r = Number(rend('pdf').lastInsertRowid);
  assert.throws(() => rend('pdf'), /UNIQUE/);
  assert.throws(() => run(db, 'INSERT INTO renditions (version_id, kind, blob_sha256, filename, mime, bytes) VALUES (?, ?, ?, ?, ?, ?)', v, 'md', 'b'.repeat(64), 'f', 'text/markdown', 1), /FOREIGN KEY/);
  run(db, 'INSERT INTO document_text (rendition_id, text) VALUES (?, ?)', r, 'hello');
  assert.throws(() => run(db, 'INSERT INTO document_text (rendition_id, text) VALUES (?, ?)', r, 'again'), /UNIQUE|PRIMARY KEY/);
  // Deleting the document cascades through versions, renditions and text; the blob stays.
  run(db, "DELETE FROM documents WHERE id = 'DOC-000001'");
  assert.equal(db.prepare('SELECT count(*) AS n FROM document_text').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM blobs').get().n, 1);
  db.close();
});

test('document relations: type CHECK, uniqueness, document targets enforced, template targets for generated_from', () => {
  const db = fresh();
  addDoc(db, 'DOC-000001');
  addDoc(db, 'DOC-000002');
  const rel = (from, to, type) => run(db, 'INSERT INTO document_relations (from_doc, to_doc, type) VALUES (?, ?, ?)', from, to, type);
  rejects(() => rel('DOC-000002', 'DOC-000001', 'cites'));
  rel('DOC-000002', 'DOC-000001', 'pays');
  assert.throws(() => rel('DOC-000002', 'DOC-000001', 'pays'), /UNIQUE/);
  rel('DOC-000002', 'DOC-000001', 'follows');
  assert.throws(() => rel('DOC-000002', 'DOC-000404', 'pays'), /FOREIGN KEY/);
  rejects(() => rel('DOC-000001', 'DOC-000001', 'based_on'));
  rel('DOC-000001', 'template:invoice@1', 'generated_from');
  rejects(() => rel('DOC-000002', 'DOC-000001', 'generated_from'));
  rejects(() => rel('DOC-000002', 'template:invoice@1', 'based_on'), /CHECK constraint failed|FOREIGN KEY/);
  run(db, "DELETE FROM documents WHERE id = 'DOC-000001'");
  assert.equal(db.prepare('SELECT count(*) AS n FROM document_relations').get().n, 0);
  db.close();
});

test('document_entities: role CHECK, unique on (document, entity, role)', () => {
  const db = fresh();
  addDoc(db);
  const e = addEntity(db);
  const link = (role) => run(db, 'INSERT INTO document_entities (document_id, entity_id, role) VALUES (?, ?, ?)', 'DOC-000001', e, role);
  rejects(() => link('witness'));
  link('party');
  link('contact');
  assert.throws(() => link('party'), /UNIQUE|PRIMARY KEY/);
  db.close();
});

test('templates, sequences, audit_log, settings constraints', () => {
  const db = fresh();
  rejects(() => run(db, "INSERT INTO templates (id, version, source, hash) VALUES ('invoice', 1, 'remote', 'h')"));
  run(db, "INSERT INTO templates (id, version, source, hash, meta_json) VALUES ('invoice', 1, 'builtin', 'h', '{}')");
  assert.throws(() => run(db, "INSERT INTO templates (id, version, source, hash) VALUES ('invoice', 1, 'workspace', 'h2')"), /UNIQUE|PRIMARY KEY/);
  rejects(() => run(db, "INSERT INTO sequences (scope_key, next) VALUES ('x', -1)"));
  rejects(() => run(db, "INSERT INTO audit_log (at, actor, action, target_kind, before) VALUES ('t', 'a', 'x', 'k', '{bad')"));
  run(db, "INSERT INTO settings (key, value) VALUES ('clearance', 'Internal')");
  db.close();
});
