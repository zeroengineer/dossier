import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from '../helpers/tmp.js';
import { exampleSeries, writeWorkspace } from '../helpers/workspace.js';
import { makePdf } from '../helpers/pdf.js';
import { openContext } from '../../src/context.js';
import { uploadFile } from '../../src/services/upload.js';
import { getDocument, readRendition, DOCUMENT_CHANGED } from '../../src/services/documents.js';

async function withCtx(fn, { clearance = 'Confidential' } = {}) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    writeWorkspace(dir, { workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: { tester: { clearance } } }, series: exampleSeries() });
    ctx = openContext({ home: dir, user: 'tester', dbFile: ':memory:', env: {} });
    return await fn(ctx, dir);
  } finally {
    ctx?.close();
    cleanup();
  }
}

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const count = (ctx, table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const texts = (ctx) => ctx.db.prepare('SELECT r.kind, t.text FROM document_text t JOIN renditions r ON r.id = t.rendition_id ORDER BY r.id').all();

test('PDF upload creates a document with original + pdf renditions and extracted text', () => withCtx(async (ctx) => {
  const events = [];
  ctx.repo.events.on(DOCUMENT_CHANGED, (p) => events.push(p));
  const buf = await makePdf(['Signed agreement for Acme Events', 'Annexure page']);
  const res = await uploadFile(ctx, { buffer: buf, filename: 'agreement.pdf', mime: 'application/pdf', meta: { type: 'agreement' } });
  assert.equal(res.deduped, false);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.document.id, 'DOC-000001');
  assert.equal(res.document.title, 'agreement', 'title defaults to the file name without extension');
  assert.equal(res.version.versionNo, 1);
  assert.deepEqual(res.version.renditions.map((r) => r.kind).sort(), ['original', 'pdf']);
  for (const r of res.version.renditions) {
    assert.equal(r.filename, 'agreement.pdf');
    assert.equal(r.mime, 'application/pdf');
    assert.equal(r.pageCount, 2);
  }
  assert.equal(count(ctx, 'blobs'), 1, 'both renditions share one blob');
  const t = texts(ctx);
  assert.equal(t.length, 1, 'text stored once, on the original');
  assert.equal(t[0].kind, 'original');
  assert.match(t[0].text, /Signed agreement for Acme Events[\s\S]*Annexure page/);
  assert.deepEqual(readRendition(ctx, res.document.id, { kind: 'original' }).buffer, buf);
  assert.ok(events.some((e) => e.ids.includes(res.document.id)));
}));

test('uploading the same bytes twice stores one blob and reports deduped', () => withCtx(async (ctx) => {
  const buf = Buffer.from('# Meeting notes\n\nAgenda for the example event.\n');
  const a = await uploadFile(ctx, { buffer: buf, filename: 'notes.md', mime: 'text/markdown', meta: { type: 'note', title: 'Notes' } });
  const b = await uploadFile(ctx, { buffer: Buffer.from(buf), filename: 'notes-copy.md', meta: { type: 'note' } });
  assert.equal(a.deduped, false);
  assert.equal(b.deduped, true);
  assert.notEqual(a.document.id, b.document.id);
  assert.equal(count(ctx, 'blobs'), 1);
  assert.equal(count(ctx, 'renditions'), 4);
  assert.deepEqual(b.version.renditions.map((r) => r.kind).sort(), ['md', 'original']);
  assert.equal(b.version.renditions.find((r) => r.kind === 'md').mime, 'text/markdown', 'mime inferred from the extension');
  assert.deepEqual(texts(ctx).map((r) => r.text), [buf.toString(), buf.toString()]);
}));

test('HTML upload extracts stripped text; unknown types keep only the original', () => withCtx(async (ctx) => {
  const html = await uploadFile(ctx, {
    buffer: Buffer.from('<html><head><style>b{}</style></head><body><p>Quote &amp; scope</p></body></html>'),
    filename: 'quote.HTM', mime: 'text/html', meta: { type: 'quote' },
  });
  assert.deepEqual(html.version.renditions.map((r) => r.kind).sort(), ['html', 'original']);
  assert.equal(texts(ctx)[0].text, 'Quote & scope');

  const png = await uploadFile(ctx, { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), filename: 'photo.png', mime: 'image/png', meta: { type: 'photo' } });
  assert.deepEqual(png.version.renditions.map((r) => [r.kind, r.mime]), [['original', 'image/png']]);
  assert.equal(texts(ctx).length, 1, 'no text row for a file with no extractable text');
}));

test('a repeated number in a series is accepted with a NUMBER_CONFLICT warning', () => withCtx(async (ctx) => {
  const meta = { type: 'invoice', numberSeries: 'invoice-main', docNumber: 'INV-0131' };
  const a = await uploadFile(ctx, { buffer: Buffer.from('first'), filename: 'a.txt', meta });
  const b = await uploadFile(ctx, { buffer: Buffer.from('second'), filename: 'b.txt', meta });
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(b.warnings, ['NUMBER_CONFLICT']);
  assert.equal(b.document.numberConflict, true);
}));

test('meta.documentId adds a version to an existing document', () => withCtx(async (ctx) => {
  const a = await uploadFile(ctx, { buffer: Buffer.from('v1 text'), filename: 'letter.txt', meta: { type: 'letter' } });
  const b = await uploadFile(ctx, { buffer: Buffer.from('v2 text'), filename: 'letter-signed.txt', meta: { documentId: a.document.id, note: 'signed copy' } });
  assert.equal(b.document.id, a.document.id);
  assert.equal(b.version.versionNo, 2);
  assert.equal(b.version.note, 'signed copy');
  assert.equal(getDocument(ctx, a.document.id).currentVersion, 2);
  assert.equal(count(ctx, 'documents'), 1);

  const c = await uploadFile(ctx, { buffer: Buffer.from('draft'), filename: 'x.txt', meta: { documentId: a.document.id, makeCurrent: false } });
  assert.equal(c.version.isCurrent, false);
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('x'), filename: 'x.txt', meta: { documentId: a.document.id, title: 'nope' } }), code('INVALID_INPUT'));
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('x'), filename: 'x.txt', meta: { documentId: 'DOC-999999' } }), code('DOCUMENT_NOT_FOUND'));
}));

test('secrets are refused before anything is stored', () => withCtx(async (ctx) => {
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('k'), filename: 'server.pem', meta: { type: 'key' } }), code('SECRET_REJECTED'));
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nabc'), filename: 'notes.txt', meta: { type: 'note' } }), code('SECRET_REJECTED'));
  // The marker only appears after extraction (entity-encoded in the HTML bytes).
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('<p>PRIVATE&#32;KEY</p>'), filename: 'k.html', meta: { type: 'note' } }), code('SECRET_REJECTED'));
  assert.equal(count(ctx, 'documents'), 0);
  assert.equal(count(ctx, 'blobs'), 0);
}));

test('invalid input and failed metadata leave nothing behind', () => withCtx(async (ctx) => {
  await assert.rejects(uploadFile(ctx, { buffer: 'text', filename: 'a.txt', meta: { type: 'x' } }), code('INVALID_INPUT'));
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('a'), filename: ' ', meta: { type: 'x' } }), code('INVALID_INPUT'));
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('a'), filename: 'a.txt', meta: {} }), code('INVALID_INPUT'));
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('a'), filename: 'a.txt', meta: { type: 'x', sensitivity: 'Restricted' } }), code('FORBIDDEN'));
  assert.equal(count(ctx, 'documents'), 0);
  assert.equal(count(ctx, 'blobs'), 0);
}));
