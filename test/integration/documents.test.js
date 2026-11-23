import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { upsertEntity } from '../../src/services/entities.js';
import { putBlob, readBlob, blobPath, sha256Of } from '../../src/services/blobs.js';
import * as documents from '../../src/services/documents.js';

const {
  createDocument, addVersion, setCurrentVersion, updateStatus, updateMetadata, supersede,
  linkDocuments, unlinkDocuments, getDocument, listDocuments, DOCUMENT_CHANGED,
} = documents;

function withCtx(fn, { clearance = 'Confidential' } = {}) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    writeWorkspace(dir, { workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: { tester: { clearance } } } });
    ctx = openContext({ home: dir, user: 'tester', dbFile: ':memory:', env: {} });
    return fn(ctx, dir);
  } finally {
    ctx?.close();
    cleanup();
  }
}

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const audits = (ctx, prefix) => ctx.db.prepare('SELECT * FROM audit_log WHERE action LIKE ? ORDER BY id').all(`${prefix}%`);
const pdf = (s) => Buffer.from(`%PDF-1.7 ${s}`);
const client = (ctx, name = 'Demo Retail LLP') => upsertEntity(ctx, { kind: 'client', name });

test('putBlob stores byte-identical content once, atomically, under blobs/<ab>/<sha>', () => withCtx((ctx, home) => {
  const buf = Buffer.from('hello vault');
  const a = putBlob(ctx, buf, { mime: 'text/plain' });
  assert.equal(a.sha256, sha256Of(buf));
  assert.equal(a.bytes, buf.length);
  assert.equal(a.created, true);
  const file = blobPath(ctx, a.sha256);
  assert.equal(file, join(home, 'data', 'blobs', a.sha256.slice(0, 2), a.sha256));
  assert.deepEqual(readFileSync(file), buf);
  const b = putBlob(ctx, Buffer.from('hello vault'), { mime: 'application/octet-stream' });
  assert.deepEqual(b, { sha256: a.sha256, bytes: buf.length, created: false });
  assert.deepEqual(readBlob(ctx, a.sha256), buf);
  const rows = ctx.db.prepare('SELECT * FROM blobs').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mime, 'text/plain');
  assert.equal(rows[0].stored_path, `blobs/${a.sha256.slice(0, 2)}/${a.sha256}`);
  assert.deepEqual(readdirSync(join(home, 'data', 'blobs', a.sha256.slice(0, 2))), [a.sha256], 'no temp files left behind');
  assert.equal(audits(ctx, 'blob.').length, 1);
  assert.throws(() => readBlob(ctx, 'f'.repeat(64)), code('BLOB_NOT_FOUND'));
  assert.throws(() => blobPath(ctx, '../x'), code('INVALID_INPUT'));
}));

test('createDocument allocates ids, infers party type, links entities, audits and emits document:changed', () => withCtx((ctx) => {
  const events = [];
  ctx.repo.events.on(DOCUMENT_CHANGED, (p) => events.push(p));
  const c = client(ctx);
  const person = upsertEntity(ctx, { kind: 'person', name: 'Jane Example' });
  const doc = createDocument(ctx, {
    type: 'Invoice', title: 'Event services', partyId: c.id, issuingBrandId: 'acme', numberSeries: 'invoice',
    docNumber: 'ACME-2026-0001', docDate: '2026-07-14', dueDate: '2026-07-28', amountMinor: 1250000, currency: 'INR',
    templateId: 'invoice', templateVersion: 1, entities: [{ entityId: person.id, role: 'contact' }],
  });
  assert.equal(doc.id, 'DOC-000001');
  assert.equal(doc.status, 'Draft');
  assert.equal(doc.sensitivity, 'Internal');
  assert.deepEqual(doc.party, { id: c.id, kind: 'client', name: 'Demo Retail LLP', type: 'Client' });
  assert.equal(doc.numberConflict, false);
  assert.deepEqual(doc.template, { id: 'invoice', version: 1 });
  assert.deepEqual(doc.entities, [{ id: person.id, kind: 'person', name: 'Jane Example', role: 'contact' }]);
  assert.deepEqual(doc.versions, []);
  assert.equal(doc.currentVersion, null);
  assert.equal(doc.createdBy, 'tester');
  assert.deepEqual(events, [{ ids: ['DOC-000001'] }]);
  const [row] = audits(ctx, 'document.');
  assert.equal(row.action, 'document.create');
  assert.equal(JSON.parse(row.after).docNumber, 'ACME-2026-0001');
  assert.equal(createDocument(ctx, { type: 'Letter' }).id, 'DOC-000002');

  assert.throws(() => createDocument(ctx, { title: 'no type' }), code('INVALID_INPUT'));
  assert.throws(() => createDocument(ctx, { type: 'Invoice', amountMinor: 100 }), code('INVALID_INPUT'));
  assert.throws(() => createDocument(ctx, { type: 'Invoice', docDate: '2026-02-30' }), code('INVALID_INPUT'));
  assert.throws(() => createDocument(ctx, { type: 'Invoice', bogus: 1 }), code('INVALID_INPUT'));
  assert.throws(() => createDocument(ctx, { type: 'Invoice', partyId: 9999 }), code('ENTITY_NOT_FOUND'));
  assert.throws(() => createDocument(ctx, { type: 'Invoice', issuingBrandId: 'nope' }), code('BRAND_NOT_FOUND'));
  assert.throws(() => createDocument(ctx, { type: 'Invoice', engagementId: c.id }), code('INVALID_INPUT'));
  assert.throws(() => createDocument(ctx, { type: 'Invoice', entities: [{ entityId: c.id, role: 'boss' }] }), code('INVALID_INPUT'));
}));

test('a repeated number in a series is stored with numberConflict and an audit warning', () => withCtx((ctx) => {
  const a = createDocument(ctx, { type: 'Invoice', numberSeries: 'invoice', docNumber: 'ACME-2026-0131' });
  const b = createDocument(ctx, { type: 'Invoice', numberSeries: 'invoice', docNumber: 'ACME-2026-0131' });
  const other = createDocument(ctx, { type: 'Receipt', numberSeries: 'receipt', docNumber: 'ACME-2026-0131' });
  assert.equal(a.numberConflict, false);
  assert.equal(b.numberConflict, true);
  assert.equal(other.numberConflict, false, 'numbers are unique per series only');
  const warnings = audits(ctx, 'document.number_conflict');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].target_id, b.id);
  assert.deepEqual(JSON.parse(warnings[0].after).conflictsWith, [a.id]);

  const fixed = updateMetadata(ctx, b.id, { docNumber: 'ACME-2026-0132' });
  assert.equal(fixed.numberConflict, false);
  const again = updateMetadata(ctx, other.id, { numberSeries: 'invoice' });
  assert.equal(again.numberConflict, true);
  assert.equal(audits(ctx, 'document.number_conflict').length, 2);
}));

test('addVersion stores renditions once by sha256 and keeps exactly one current version', () => withCtx((ctx) => {
  const c = client(ctx);
  const doc = createDocument(ctx, { type: 'Invoice', partyId: c.id, docNumber: 'ACME-2026-0007', docDate: '2026-07-14' });
  const shared = pdf('one');
  const v1 = addVersion(ctx, doc.id, {
    inputJson: { items: [1] }, note: 'first',
    renditions: [
      { kind: 'pdf', buffer: shared, filename: 'invoice.pdf', extractedText: 'Invoice one', pageCount: 1 },
      { kind: 'md', buffer: Buffer.from('# Invoice'), filename: 'invoice.md' },
    ],
  });
  assert.equal(v1.versionNo, 1);
  assert.equal(v1.isCurrent, true);
  assert.deepEqual(v1.input, { items: [1] });
  assert.equal(v1.renditions[0].sha256, sha256Of(shared));
  assert.equal(v1.renditions[0].mime, 'application/pdf');
  assert.equal(v1.renditions[0].displayName, '2026-07-14_DemoRetailLLP_Invoice_ACME-2026-0007_v1.pdf');
  assert.equal(v1.renditions[1].mime, 'text/markdown');

  const v2 = addVersion(ctx, doc.id, { renditions: [{ kind: 'pdf', buffer: Buffer.from(shared), filename: 'invoice-v2.pdf' }] });
  assert.equal(v2.versionNo, 2);
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM blobs').get().n, 2, 'identical pdf bytes stored once');
  const v3 = addVersion(ctx, doc.id, { makeCurrent: false, renditions: [{ kind: 'original', buffer: pdf('scan'), filename: 'Scan 01.PDF' }] });
  assert.equal(v3.isCurrent, false);
  assert.equal(v3.renditions[0].displayName, '2026-07-14_DemoRetailLLP_Invoice_ACME-2026-0007_v3.pdf');

  let full = getDocument(ctx, doc.id);
  assert.equal(full.currentVersion, 2);
  assert.deepEqual(full.versions.map((v) => [v.versionNo, v.isCurrent]), [[1, false], [2, true], [3, false]]);
  assert.deepEqual(full.renditions.map((r) => r.filename), ['invoice-v2.pdf']);
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM versions WHERE document_id = ? AND is_current = 1').get(doc.id).n, 1);
  assert.equal(ctx.db.prepare('SELECT text FROM document_text').get().text, 'Invoice one');

  full = setCurrentVersion(ctx, doc.id, 1);
  assert.equal(full.currentVersion, 1);
  assert.deepEqual(full.renditions.map((r) => r.kind), ['pdf', 'md']);
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM versions WHERE document_id = ? AND is_current = 1').get(doc.id).n, 1);
  assert.deepEqual(audits(ctx, 'document.version').map((r) => r.action),
    ['document.version.add', 'document.version.add', 'document.version.add', 'document.version.set_current']);
  assert.throws(() => setCurrentVersion(ctx, doc.id, 9), code('VERSION_NOT_FOUND'));

  assert.throws(() => addVersion(ctx, doc.id, { renditions: [] }), code('INVALID_INPUT'));
  assert.throws(() => addVersion(ctx, doc.id, { renditions: [{ kind: 'pdf', buffer: pdf('a'), filename: 'a.pdf' }, { kind: 'pdf', buffer: pdf('b'), filename: 'b.pdf' }] }), code('INVALID_INPUT'));
  assert.throws(() => addVersion(ctx, doc.id, { renditions: [{ kind: 'docx', buffer: pdf('a'), filename: 'a.docx' }] }), code('INVALID_INPUT'));
  assert.throws(() => addVersion(ctx, 'DOC-999999', { renditions: [{ kind: 'pdf', buffer: pdf('a'), filename: 'a.pdf' }] }), code('DOCUMENT_NOT_FOUND'));
}));

test('no exported vault function modifies a stored original rendition', () => withCtx((ctx) => {
  const doc = createDocument(ctx, { type: 'Agreement' });
  const original = pdf('signed original');
  addVersion(ctx, doc.id, { renditions: [{ kind: 'original', buffer: original, filename: 'signed.pdf' }] });
  const before = ctx.db.prepare("SELECT * FROM renditions WHERE kind = 'original'").get();
  addVersion(ctx, doc.id, { renditions: [{ kind: 'original', buffer: pdf('stamped'), filename: 'signed.pdf' }] });
  setCurrentVersion(ctx, doc.id, 1);
  updateMetadata(ctx, doc.id, { title: 'Renamed', docNumber: 'X-1' });
  updateStatus(ctx, doc.id, 'Signed');
  assert.deepEqual(ctx.db.prepare('SELECT * FROM renditions WHERE id = ?').get(before.id), before);
  assert.deepEqual(readBlob(ctx, before.blob_sha256), original);
  const writers = Object.keys(documents).filter((k) => /rendition/i.test(k) && /update|delete|remove|replace|set/i.test(k));
  assert.deepEqual(writers, []);
}));

test('updateStatus enforces transitions; supersede marks the old document and relates new -> old', () => withCtx((ctx) => {
  const a = createDocument(ctx, { type: 'Quotation' });
  assert.equal(updateStatus(ctx, a.id, 'Sent').status, 'Sent');
  assert.equal(updateStatus(ctx, a.id, 'Sent').status, 'Sent', 'same status is a no-op');
  assert.throws(() => updateStatus(ctx, a.id, 'Draft'), code('INVALID_STATUS_TRANSITION'));
  assert.throws(() => updateStatus(ctx, a.id, 'Void'), code('INVALID_INPUT'));
  assert.equal(audits(ctx, 'document.status').length, 1);

  const b = createDocument(ctx, { type: 'Quotation' });
  const old = supersede(ctx, a.id, b.id);
  assert.equal(old.status, 'Superseded');
  assert.deepEqual(old.relations.map((r) => [r.type, r.direction, r.document.id]), [['supersedes', 'in', b.id]]);
  const fresh = getDocument(ctx, b.id);
  assert.deepEqual(fresh.relations.map((r) => [r.type, r.direction, r.document.id]), [['supersedes', 'out', a.id]]);
  assert.throws(() => supersede(ctx, a.id, b.id), code('INVALID_STATUS_TRANSITION'));
  assert.throws(() => updateStatus(ctx, a.id, 'Paid'), code('INVALID_STATUS_TRANSITION'));
  assert.throws(() => supersede(ctx, b.id, b.id), code('INVALID_INPUT'));
}));

test('linkDocuments relates documents and templates in both directions; unlink removes', () => withCtx((ctx) => {
  const events = [];
  const q = createDocument(ctx, { type: 'Quotation' });
  const inv = createDocument(ctx, { type: 'Invoice' });
  const rec = createDocument(ctx, { type: 'Receipt' });
  ctx.repo.events.on(DOCUMENT_CHANGED, (p) => events.push(p));
  linkDocuments(ctx, inv.id, q.id, 'based_on');
  const rel = linkDocuments(ctx, rec.id, inv.id, 'pays', { amountMinor: 100 });
  assert.deepEqual(rel.attrs, { amountMinor: 100 });
  linkDocuments(ctx, rec.id, inv.id, 'pays', { amountMinor: 100 });
  linkDocuments(ctx, inv.id, 'template:invoice@1', 'generated_from');
  assert.equal(audits(ctx, 'document.link').length, 3, 'relinking with the same attrs writes nothing');
  assert.deepEqual(events, [{ ids: [inv.id, q.id] }, { ids: [rec.id, inv.id] }, { ids: [inv.id] }]);

  const full = getDocument(ctx, inv.id);
  assert.deepEqual(full.relations.map((r) => [r.type, r.direction, r.document?.id ?? null, r.template]), [
    ['based_on', 'out', q.id, null],
    ['pays', 'in', rec.id, null],
    ['generated_from', 'out', null, { id: 'invoice', version: 1 }],
  ]);
  assert.throws(() => linkDocuments(ctx, inv.id, inv.id, 'follows'), code('INVALID_INPUT'));
  assert.throws(() => linkDocuments(ctx, inv.id, 'DOC-000999', 'follows'), code('DOCUMENT_NOT_FOUND'));
  assert.throws(() => linkDocuments(ctx, inv.id, q.id, 'likes'), code('INVALID_INPUT'));
  assert.throws(() => linkDocuments(ctx, inv.id, 'invoice', 'generated_from'), code('INVALID_INPUT'));

  assert.equal(unlinkDocuments(ctx, rec.id, inv.id, 'pays'), true);
  assert.equal(unlinkDocuments(ctx, rec.id, inv.id, 'pays'), false);
  assert.deepEqual(getDocument(ctx, inv.id).relations.map((r) => r.type), ['based_on', 'generated_from']);
}));

test('updateMetadata audits before/after, re-infers party type and replaces entity links', () => withCtx((ctx) => {
  const c = client(ctx);
  const v = upsertEntity(ctx, { kind: 'vendor', name: 'Example Supplies' });
  const doc = createDocument(ctx, { type: 'Invoice', partyId: c.id });
  const after = updateMetadata(ctx, doc.id, { partyId: v.id, title: 'Supplies', entities: [{ entityId: c.id, role: 'named' }] });
  assert.equal(after.party.type, 'Vendor');
  assert.equal(after.title, 'Supplies');
  assert.deepEqual(after.entities.map((e) => [e.id, e.role]), [[c.id, 'named']]);
  const [row] = audits(ctx, 'document.update');
  assert.equal(JSON.parse(row.before).partyId, c.id);
  assert.equal(JSON.parse(row.after).partyId, v.id);
  updateMetadata(ctx, doc.id, { title: 'Supplies' });
  assert.equal(audits(ctx, 'document.update').length, 1, 'no-op patch writes nothing');
  assert.equal(updateMetadata(ctx, doc.id, { partyId: null }).party, null);
  assert.throws(() => updateMetadata(ctx, doc.id, { status: 'Paid' }), code('INVALID_INPUT'));
}));

test('sensitivity filters lists and blocks reads above the user clearance', () => withCtx((ctx) => {
  ctx.user.clearance = 'Restricted';
  const pub = createDocument(ctx, { type: 'Brochure', sensitivity: 'Public', docDate: '2026-01-01' });
  const internal = createDocument(ctx, { type: 'Invoice', docDate: '2026-03-01' });
  const conf = createDocument(ctx, { type: 'Agreement', sensitivity: 'Confidential', docDate: '2026-02-01' });
  const restricted = createDocument(ctx, { type: 'Credentials Note', sensitivity: 'Restricted' });
  linkDocuments(ctx, internal.id, conf.id, 'based_on');
  assert.deepEqual(listDocuments(ctx).map((d) => d.id), [internal.id, conf.id, pub.id, restricted.id]);

  ctx.user.clearance = 'Internal';
  assert.deepEqual(listDocuments(ctx).map((d) => d.id), [internal.id, pub.id]);
  assert.deepEqual(listDocuments(ctx, { sensitivity: 'Confidential' }), []);
  assert.deepEqual(listDocuments(ctx, { type: 'Invoice' }).map((d) => d.id), [internal.id]);
  assert.deepEqual(listDocuments(ctx, { from: '2026-02-15', to: '2026-12-31' }).map((d) => d.id), [internal.id]);
  assert.throws(() => getDocument(ctx, conf.id), code('FORBIDDEN'));
  assert.throws(() => updateStatus(ctx, conf.id, 'Sent'), code('FORBIDDEN'));
  assert.deepEqual(getDocument(ctx, internal.id).relations, [], 'related documents above clearance are hidden');
  assert.throws(() => createDocument(ctx, { type: 'Invoice', sensitivity: 'Confidential' }), code('FORBIDDEN'));
  assert.throws(() => listDocuments(ctx, { colour: 'red' }), code('INVALID_INPUT'));

  ctx.user.clearance = 'Public';
  assert.deepEqual(listDocuments(ctx).map((d) => d.id), [pub.id]);
}, { clearance: 'Restricted' }));

test('addVersion rejects files that look like secrets with SECRET_REJECTED and stores nothing', () => withCtx((ctx, home) => {
  const doc = createDocument(ctx, { type: 'Credentials Note', sensitivity: 'Restricted' });
  const tries = [
    { kind: 'original', buffer: Buffer.from('abc'), filename: 'server.pem' },
    { kind: 'original', buffer: Buffer.from('abc'), filename: 'deploy.key' },
    { kind: 'original', buffer: Buffer.from('TOKEN=1'), filename: '.env' },
    { kind: 'original', buffer: Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nabc'), filename: 'notes.txt' },
    { kind: 'md', buffer: Buffer.from('# Note'), filename: 'note.md', extractedText: 'PRIVATE KEY here' },
  ];
  for (const r of tries) {
    assert.throws(() => addVersion(ctx, doc.id, { renditions: [r] }), code('SECRET_REJECTED'), r.filename);
  }
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM versions').get().n, 0);
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM blobs').get().n, 0);
  assert.equal(existsSync(join(home, 'data', 'blobs')), false);
  const ok = addVersion(ctx, doc.id, { renditions: [{ kind: 'md', buffer: Buffer.from('Stored in the password manager.'), filename: 'note.md' }] });
  assert.equal(ok.versionNo, 1);
}, { clearance: 'Restricted' }));
