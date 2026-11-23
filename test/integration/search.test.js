import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { upsertEntity } from '../../src/services/entities.js';
import {
  createDocument, addVersion, setCurrentVersion, updateMetadata, linkDocuments,
} from '../../src/services/documents.js';
import { uploadFile } from '../../src/services/upload.js';
import { reindexAll, reindexDocument } from '../../src/services/searchIndex.js';
import { search } from '../../src/services/search.js';
import { main } from '../../src/cli.js';

const USERS = { tester: { clearance: 'Confidential' }, boss: { clearance: 'Restricted' }, guest: { clearance: 'Public' } };

async function withHome(fn) {
  const { dir, cleanup } = tmpDir();
  const opened = [];
  try {
    writeWorkspace(dir, { workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: USERS } });
    const open = (user = 'tester') => {
      const ctx = openContext({ home: dir, user, dbFile: join(dir, 'data', 'test.sqlite'), env: {} });
      opened.push(ctx);
      return ctx;
    };
    return await fn(open, dir);
  } finally {
    for (const c of opened) c.close();
    cleanup();
  }
}

const withCtx = (fn) => withHome((open, dir) => fn(open(), dir, open));

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const ids = (list) => list.map((h) => h.document.id);
const md = (text) => ({ kind: 'md', buffer: Buffer.from(text), filename: 'body.md', extractedText: text });

/** Quotation -> MoU -> invoice <- receipt, settlement: the usual client paper trail. */
function paperTrail(ctx) {
  const client = upsertEntity(ctx, { kind: 'client', name: 'Demo Retail LLP' });
  const doc = (type, extra = {}) => createDocument(ctx, { type, partyId: client.id, docDate: '2026-07-01', ...extra }).id;
  const quotation = doc('Quotation', { title: 'Stage build quotation', docNumber: 'QT-2026-014', numberSeries: 'qt' });
  const mou = doc('MoU', { title: 'Memorandum of understanding' });
  const invoice = doc('Invoice', { title: 'Stage build', docNumber: 'INV-2026-001', numberSeries: 'inv', docDate: '2026-07-14' });
  const receipt = doc('Receipt', { title: 'Payment received', docNumber: 'RC-2026-003', numberSeries: 'rc', docDate: '2026-08-01' });
  const settlement = doc('Settlement', { title: 'Final settlement' });
  const other = doc('Invoice', { title: 'Unrelated', docNumber: 'INV-2026-0019', numberSeries: 'inv' });
  linkDocuments(ctx, mou, quotation, 'based_on');
  linkDocuments(ctx, invoice, mou, 'based_on');
  linkDocuments(ctx, invoice, quotation, 'based_on');
  linkDocuments(ctx, receipt, invoice, 'pays');
  linkDocuments(ctx, settlement, invoice, 'settles');
  return { client, quotation, mou, invoice, receipt, settlement, other };
}

test('a document number returns the document first and its linked papers one hop away', () => withCtx((ctx) => {
  const t = paperTrail(ctx);
  const res = search(ctx, { q: 'INV-2026-001' });
  assert.equal(res.hits[0].document.id, t.invoice);
  assert.equal(res.hits[0].match, 'number');
  assert.equal(res.hits[0].snippet, null);
  assert.ok(typeof res.hits[0].score === 'number');
  const rel = new Map(res.related.map((r) => [r.document.id, r.via]));
  for (const id of [t.quotation, t.mou, t.receipt, t.settlement]) assert.ok(rel.has(id), `related misses ${id}`);
  assert.deepEqual(rel.get(t.receipt), { kind: 'document', relation: 'pays', from: t.invoice });
  assert.deepEqual(rel.get(t.settlement), { kind: 'document', relation: 'settles', from: t.invoice });
  assert.deepEqual(rel.get(t.quotation), { kind: 'document', relation: 'based_on', from: t.invoice });
  assert.ok(!ids(res.related).includes(t.invoice), 'a hit is never also related');
  assert.equal(new Set(ids(res.related)).size, res.related.length, 'related documents are listed once');

  // Exact match ranks above prefix matches; matching is case-insensitive.
  const lower = search(ctx, { q: 'inv-2026-001' });
  assert.deepEqual(ids(lower.hits).slice(0, 2), [t.invoice, t.other]);
  assert.equal(lower.hits[1].match, 'number');
  // A prefix finds the series' numbers.
  assert.deepEqual(ids(search(ctx, { q: 'INV-2026' }).hits).slice(0, 2).sort(), [t.invoice, t.other].sort());
  // The document id works like a number.
  assert.equal(search(ctx, { q: t.receipt.toLowerCase() }).hits[0].document.id, t.receipt);
  // expand: false leaves related empty.
  assert.deepEqual(search(ctx, { q: 'INV-2026-001', expand: false }).related, []);
}));

test('a person search returns their documents plus documents where they sign or are named', () => withCtx((ctx) => {
  const person = upsertEntity(ctx, { kind: 'person', name: 'Jordan Placeholder', aliases: ['J. Placeholder'] });
  const client = upsertEntity(ctx, { kind: 'client', name: 'Demo Retail LLP' });
  const letter = createDocument(ctx, { type: 'Offer Letter', title: 'Offer', partyId: person.id }).id;
  const agreement = createDocument(ctx, { type: 'Agreement', title: 'Services agreement', partyId: client.id, entities: [{ entityId: person.id, role: 'signatory' }] }).id;
  const minutes = createDocument(ctx, { type: 'Board Resolution', title: 'Resolution', entities: [{ entityId: person.id, role: 'named' }] }).id;
  const contactOnly = createDocument(ctx, { type: 'Letter', title: 'Cover', entities: [{ entityId: person.id, role: 'contact' }] }).id;

  for (const q of ['Jordan Placeholder', 'j placeholder']) {
    const res = search(ctx, { q });
    assert.ok(ids(res.hits).includes(letter), `${q}: party document is a hit`);
    assert.equal(res.hits.find((h) => h.document.id === letter).match, 'metadata');
    assert.deepEqual(res.entities.map((e) => e.id), [person.id]);
    const rel = new Map(res.related.map((r) => [r.document.id, r.via]));
    assert.deepEqual(rel.get(agreement), { kind: 'entity', relation: 'signatory', from: person.id });
    assert.deepEqual(rel.get(minutes), { kind: 'entity', relation: 'named', from: person.id });
    assert.ok(!rel.has(contactOnly), 'contact role is not expanded');
    assert.ok(!rel.has(letter));
  }
}));

test('text search finds extracted text with a snippet, stemmed', () => withCtx(async (ctx) => {
  const up = await uploadFile(ctx, {
    buffer: Buffer.from('# Venue terms\n\nThe venue deposit is refundable within thirty days of the event.\n'),
    filename: 'venue-terms.md', meta: { type: 'Terms' },
  });
  createDocument(ctx, { type: 'Note', title: 'Nothing here' });
  const res = search(ctx, { q: 'refundable deposits' });
  assert.deepEqual(ids(res.hits), [up.document.id]);
  assert.equal(res.hits[0].match, 'text');
  assert.match(res.hits[0].snippet, /\[deposit\] is \[refundable\]/);
  // Metadata outranks text.
  const titled = createDocument(ctx, { type: 'Note', title: 'Deposit refundable policy' }).id;
  const both = search(ctx, { q: 'refundable deposit' });
  assert.deepEqual(ids(both.hits), [titled, up.document.id]);
  assert.equal(both.hits[0].match, 'metadata');
}));

test('the index follows the current version, metadata edits and entity renames', () => withCtx((ctx) => {
  const client = upsertEntity(ctx, { kind: 'client', name: 'Demo Retail LLP' });
  const id = createDocument(ctx, { type: 'Proposal', title: 'Spring expo', partyId: client.id }).id;
  addVersion(ctx, id, { renditions: [md('alpha banquet layout')] });
  addVersion(ctx, id, {
    renditions: [md('bravo stage layout'), { ...md('bravo stage layout'), kind: 'original', filename: 'b.md' }, { kind: 'html', buffer: Buffer.from('<p>x</p>'), filename: 'b.html', extractedText: 'charlie lighting' }],
  });
  assert.deepEqual(ids(search(ctx, { q: 'banquet' }).hits), []);
  assert.deepEqual(ids(search(ctx, { q: 'charlie' }).hits), [id]);
  const body = ctx.db.prepare('SELECT body FROM search_index WHERE doc_id = ?').get(id).body;
  assert.equal(body.match(/bravo stage layout/g).length, 1, 'identical rendition texts are indexed once');
  setCurrentVersion(ctx, id, 1);
  assert.deepEqual(ids(search(ctx, { q: 'banquet' }).hits), [id]);
  assert.deepEqual(ids(search(ctx, { q: 'charlie' }).hits), []);

  updateMetadata(ctx, id, { title: 'Autumn gala' });
  assert.deepEqual(ids(search(ctx, { q: 'gala' }).hits), [id]);
  assert.deepEqual(ids(search(ctx, { q: 'spring' }).hits), []);

  upsertEntity(ctx, { id: client.id, name: 'Example Stores LLP' });
  const hit = search(ctx, { q: 'Example Stores' }).hits.find((h) => h.document.id === id);
  assert.equal(hit?.match, 'metadata', 'renamed party is reindexed');
  assert.ok(ids(search(ctx, { q: 'Demo Retail' }).hits).includes(id), 'the old name stays as an alias');

  // A rolled-back write leaves the index as it was.
  assert.throws(() => ctx.repo.tx(() => { updateMetadata(ctx, id, { title: 'Winter fair' }); throw new Error('boom'); }), /boom/);
  assert.deepEqual(ids(search(ctx, { q: 'winter' }).hits), []);
  assert.deepEqual(ids(search(ctx, { q: 'gala' }).hits), [id]);
}));

test('reindexAll rebuilds the index and dossier reindex runs it', () => withHome(async (open, dir) => {
  const ctx = open();
  const id = createDocument(ctx, { type: 'Note', title: 'Harbour logistics' }).id;
  ctx.db.exec('DELETE FROM search_index');
  assert.deepEqual(search(ctx, { q: 'harbour' }).hits, []);
  assert.deepEqual(reindexAll(ctx), { documents: 1 });
  assert.deepEqual(ids(search(ctx, { q: 'harbour' }).hits), [id]);
  reindexDocument(ctx, 'DOC-999999');
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM search_index').get().n, 1, 'a missing document has no row');

  ctx.db.exec('DELETE FROM search_index');
  const out = { text: '', write(s) { this.text += s; return true; } };
  const err = { text: '', write(s) { this.text += s; return true; } };
  const env = { DOSSIER_HOME: dir, DOSSIER_USER: 'tester' };
  // The CLI opens the workspace's default database, so seed that one too.
  const cliCtx = openContext({ home: dir, user: 'tester', env: {} });
  createDocument(cliCtx, { type: 'Note', title: 'Harbour logistics' });
  cliCtx.db.exec('DELETE FROM search_index');
  cliCtx.close();
  assert.equal(await main(['reindex'], { stdout: out, stderr: err, env, cwd: dir }), 0, err.text);
  assert.match(out.text, /Reindexed 1 document/);
}));

test('search never shows documents above the user\'s clearance, as hits or related', () => withHome((open) => {
  const ctx = open('boss');
  const t = paperTrail(ctx);
  const secret = createDocument(ctx, { type: 'Settlement', title: 'Confidential side letter', sensitivity: 'Restricted', docNumber: 'SL-2026-001', numberSeries: 'sl' }).id;
  linkDocuments(ctx, secret, t.invoice, 'adjusts');
  const person = upsertEntity(ctx, { kind: 'person', name: 'Jordan Placeholder' });
  createDocument(ctx, { type: 'Agreement', title: 'Hidden', sensitivity: 'Restricted', entities: [{ entityId: person.id, role: 'signatory' }] });
  updateMetadata(ctx, t.receipt, { sensitivity: 'Internal' });
  updateMetadata(ctx, t.quotation, { sensitivity: 'Public' });

  assert.ok(ids(search(ctx, { q: 'INV-2026-001' }).related).includes(secret));
  assert.deepEqual(ids(search(ctx, { q: 'SL-2026-001' }).hits), [secret]);

  const staff = open('tester');
  assert.ok(!ids(search(staff, { q: 'INV-2026-001' }).related).includes(secret));
  assert.deepEqual(search(staff, { q: 'SL-2026-001' }).hits, []);
  assert.deepEqual(search(staff, { q: 'side letter' }).hits, []);
  assert.deepEqual(search(staff, { q: 'Jordan Placeholder' }).related, []);

  const guest = open('guest');
  const g = search(guest, { q: 'INV-2026-001' });
  assert.deepEqual(g.hits, [], 'the Internal invoice is hidden from a Public user');
  assert.deepEqual(search(guest, { q: 'QT-2026-014' }).hits.map((h) => h.document.id), [t.quotation]);
  assert.deepEqual(search(guest, { q: 'QT-2026-014' }).related, [], 'its Internal neighbours stay hidden');
}));

test('filters narrow hits and related documents', () => withCtx((ctx) => {
  const t = paperTrail(ctx);
  const other = upsertEntity(ctx, { kind: 'client', name: 'Sample Traders' });
  createDocument(ctx, { type: 'Invoice', title: 'Stage build', partyId: other.id, docDate: '2025-01-01' });
  const all = search(ctx, { q: 'stage build' });
  assert.ok(all.hits.length >= 3);
  assert.deepEqual(ids(search(ctx, { q: 'stage build', types: ['Invoice'], partyId: t.client.id }).hits), [t.invoice]);
  assert.deepEqual(ids(search(ctx, { q: 'stage build', types: 'Quotation' }).hits), [t.quotation]);
  assert.deepEqual(ids(search(ctx, { q: 'stage build', from: '2026-07-10', to: '2026-07-31' }).hits), [t.invoice]);
  assert.deepEqual(search(ctx, { q: 'stage build', status: ['Paid'] }).hits, []);
  const r = search(ctx, { q: 'INV-2026-001', types: ['Invoice', 'Receipt'] });
  assert.deepEqual(ids(r.related), [t.receipt]);
  assert.equal(search(ctx, { q: 'stage', limit: 1 }).hits.length, 1);
  assert.throws(() => search(ctx, { q: 'x', status: 'Archived' }), code('INVALID_INPUT'));
  assert.throws(() => search(ctx, { q: 'x', from: '2026-13-01' }), code('INVALID_INPUT'));
  assert.throws(() => search(ctx, { q: 'x', limit: 0 }), code('INVALID_INPUT'));
  assert.throws(() => search(ctx, { q: 42 }), code('INVALID_INPUT'));
  assert.throws(() => search(ctx, { q: 'x', kinds: [] }), code('INVALID_INPUT'));
}));

test('FTS syntax in the query never throws', () => withCtx((ctx) => {
  createDocument(ctx, { type: 'Note', title: 'Stage "A" (main) OR backstage', docNumber: 'N-1*', numberSeries: 'n' });
  const nasty = ['"', '""', "'", '(', ')', '*', 'a*', 'NEAR(a b)', 'a OR', 'AND', 'NOT x', 'title:stage', '{title}: x', '^stage',
    '-x', '+', 'a + b', '%', '_', '\\', 'stage"', 'N-1*', '   ', '', '...', 'col:"x" AND (y OR', 'a\u0000b'];
  for (const q of nasty) {
    assert.doesNotThrow(() => search(ctx, { q }), `query ${JSON.stringify(q)}`);
  }
  assert.equal(search(ctx, { q: 'N-1*' }).hits[0].match, 'number');
  assert.equal(search(ctx, { q: 'stage "A" (main)' }).hits.length, 1);
  assert.equal(search(ctx, { q: 'OR backstage' }).hits.length, 1, 'OR is a plain word');
  assert.deepEqual(search(ctx, { q: '   ' }), { hits: [], related: [], entities: [] });
}));

test('a database migrated before search existed is indexed when 002 is applied; deleted documents leave the index', () => withHome((open) => {
  const ctx = open();
  const id = createDocument(ctx, { type: 'Note', title: 'Harbour logistics' }).id;
  const gone = createDocument(ctx, { type: 'Note', title: 'Harbour cranes' }).id;
  ctx.db.exec("DROP TRIGGER documents_delete_search; DROP TABLE search_index; DELETE FROM schema_migrations WHERE version = 2");
  ctx.close();
  const again = open();
  assert.deepEqual(ids(search(again, { q: 'harbour' }).hits).sort(), [id, gone]);
  again.db.prepare('DELETE FROM documents WHERE id = ?').run(gone);
  assert.deepEqual(ids(search(again, { q: 'harbour' }).hits), [id]);
  assert.equal(again.db.prepare('SELECT count(*) AS n FROM search_index').get().n, 1);
}));
