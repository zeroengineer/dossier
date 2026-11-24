import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createDocument, getDocument, linkDocuments, readRendition, updateMetadata } from '../../src/services/documents.js';
import { uploadFile } from '../../src/services/upload.js';
import { generateDocument, previewDocument } from '../../src/services/generator.js';
import { listTemplateErrors, listTemplates } from '../../src/services/templates.js';
import { extractItems } from '../helpers/pdfText.js';
import { fixtureInput, withExampleCtx } from '../helpers/templateRender.js';

sharp.cache(false);
const pdfText = async (buf) => (await extractItems(buf)).map((i) => i.text).join(' ');
const rels = (ctx, id) => ctx.db.prepare("SELECT type, to_doc FROM document_relations WHERE from_doc = ? AND type != 'generated_from' ORDER BY to_doc").all(id)
  .map((r) => [r.type, r.to_doc]);

test('the invoice family loads as built-ins without errors', () => withExampleCtx(async (ctx) => {
  const ids = listTemplates(ctx).map((t) => t.id);
  for (const id of ['invoice', 'debit-note', 'receipt']) assert.ok(ids.includes(id), id);
  assert.deepEqual(listTemplateErrors(ctx), []);
}));

test('invoice, debit note and receipt share one counter and link adjusts / pays', () => withExampleCtx(async (ctx) => {
  const inv = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const dn = await generateDocument(ctx, 'debit-note', { ...fixtureInput('debit-note'), invoice: inv.documentId });
  const rec = await generateDocument(ctx, 'receipt', { ...fixtureInput('receipt'), references: [inv.documentId, dn.documentId, inv.documentId] });
  assert.deepEqual([inv.number, dn.number, rec.number], ['ACM-2026-0001', 'ACM-DN-2026-0002', 'ACM-REC-2026-0003']);

  const invDoc = getDocument(ctx, inv.documentId);
  assert.equal(invDoc.type, 'Invoice');
  assert.equal(invDoc.amountMinor, 1792898);
  assert.equal(invDoc.party.type, 'Client');
  assert.equal(invDoc.party.name, 'Example Institute of Sample Studies');
  assert.equal(invDoc.docDate, '2026-07-14');
  assert.equal(getDocument(ctx, dn.documentId).amountMinor, 684950);
  assert.equal(getDocument(ctx, rec.documentId).amountMinor, 2454950);

  assert.deepEqual(rels(ctx, dn.documentId), [['adjusts', inv.documentId]]);
  assert.deepEqual(rels(ctx, rec.documentId), [['pays', inv.documentId], ['pays', dn.documentId]].sort((a, b) => a[1].localeCompare(b[1])));
  assert.deepEqual(rels(ctx, inv.documentId), []);

  const text = await pdfText(readRendition(ctx, rec.documentId, { kind: 'pdf' }).buffer);
  assert.match(text, /ACM-REC-2026-0003/);
  assert.doesNotMatch(text, /DRAFT/);
  const md = readRendition(ctx, inv.documentId, { kind: 'md' }).buffer.toString('utf8');
  assert.match(md, /ACM-2026-0001/);
  assert.match(md, /₹ 17,928\.98/);
}));

test('preview of an invoice lists missing fields, then renders a draft', () => withExampleCtx(async (ctx) => {
  const r = await previewDocument(ctx, 'invoice', { date: '2026-07-14' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.name).sort(), ['billTo.name', 'client', 'items']);
  const ok = await previewDocument(ctx, 'invoice', fixtureInput('invoice'));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.renditions.map((x) => x.kind), ['pdf', 'html', 'md']);
}));

test('a receipt pointing at a document that does not exist is refused', () => withExampleCtx(async (ctx) => {
  await assert.rejects(generateDocument(ctx, 'receipt', { ...fixtureInput('receipt'), references: ['DOC-999999'] }),
    (err) => err?.name === 'DossierError' && /DOC-999999/.test(err.message));
}));

// ----- numbering never re-issues a number already in the series (final review I1)

const numbers = (ctx) => ctx.db.prepare("SELECT doc_number AS n FROM documents WHERE number_series = 'invoice-main' ORDER BY doc_number").all().map((r) => r.n);

test('an uploaded number is never generated again: upload ACM-2026-0001, then the invoice gets 0002', () => withExampleCtx(async (ctx) => {
  const up = await uploadFile(ctx, { buffer: Buffer.from('legacy invoice'), filename: 'old.txt',
    meta: { type: 'Invoice', numberSeries: 'invoice-main', docNumber: 'ACM-2026-0001' } });
  assert.deepEqual(up.warnings, []);
  const inv = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  assert.equal(inv.number, 'ACM-2026-0002');
  assert.equal(getDocument(ctx, inv.documentId).numberConflict, false);
  assert.deepEqual(numbers(ctx), ['ACM-2026-0001', 'ACM-2026-0002']);
}));

test('a counter that restarts (scope or pattern change) skips numbers already in the series', () => withExampleCtx(async (ctx) => {
  const a = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const b = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  assert.deepEqual([a.number, b.number], ['ACM-2026-0001', 'ACM-2026-0002']);
  // A new scope key starts from `start` again; here the counter row is simply gone.
  ctx.db.prepare("DELETE FROM sequences WHERE scope_key LIKE 'num:%'").run();
  const c = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  assert.equal(c.number, 'ACM-2026-0003');
  assert.equal(getDocument(ctx, c.documentId).numberConflict, false);
}));

test('a number set by a metadata edit seeds the counter; a conflicting edit is reported', () => withExampleCtx(async (ctx) => {
  const a = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const other = createDocument(ctx, { type: 'Invoice' });
  const edited = updateMetadata(ctx, other.id, { numberSeries: 'invoice-main', docNumber: 'ACM-2026-0005', docDate: '2026-07-14' });
  assert.deepEqual(edited.warnings, []);
  const b = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  assert.equal(b.number, 'ACM-2026-0006');
  const dup = updateMetadata(ctx, other.id, { docNumber: a.number });
  assert.equal(dup.numberConflict, true);
  assert.deepEqual(dup.warnings, ['NUMBER_CONFLICT']);
  assert.throws(() => updateMetadata(ctx, other.id, { numberSeries: 'nope' }), (e) => e?.code === 'SERIES_UNKNOWN');
  await assert.rejects(uploadFile(ctx, { buffer: Buffer.from('x'), filename: 'x.txt', meta: { type: 'Invoice', numberSeries: 'nope', docNumber: 'X-1' } }),
    (e) => e?.code === 'SERIES_UNKNOWN');
}));

test('invoice, debit note and receipt generated at once share the counter without contention', () => withExampleCtx(async (ctx) => {
  const inv = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const runs = await Promise.all([
    generateDocument(ctx, 'invoice', fixtureInput('invoice')),
    generateDocument(ctx, 'debit-note', { ...fixtureInput('debit-note'), invoice: inv.documentId }),
    generateDocument(ctx, 'receipt', { ...fixtureInput('receipt'), references: [inv.documentId] }),
    generateDocument(ctx, 'invoice', fixtureInput('invoice')),
  ]);
  assert.deepEqual(runs.map((r) => r.number), ['ACM-2026-0002', 'ACM-DN-2026-0003', 'ACM-REC-2026-0004', 'ACM-2026-0005']);
  const attempts = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'document.generate'").get().n;
  assert.equal(attempts, 5);
}));

// ----- regenerate replaces declared relations (final review I2)

test('regenerating a receipt for another invoice drops the old pays link and keeps manual links', () => withExampleCtx(async (ctx) => {
  const a = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const b = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const rec = await generateDocument(ctx, 'receipt', { ...fixtureInput('receipt'), references: [a.documentId] });
  linkDocuments(ctx, rec.documentId, a.documentId, 'follows');
  assert.deepEqual(rels(ctx, rec.documentId), [['follows', a.documentId], ['pays', a.documentId]]);

  const again = await generateDocument(ctx, 'receipt', { ...fixtureInput('receipt'), references: [b.documentId] }, { documentId: rec.documentId });
  assert.equal(again.versionNo, 2);
  assert.equal(again.number, rec.number);
  assert.deepEqual(rels(ctx, rec.documentId), [['follows', a.documentId], ['pays', b.documentId]]);
  const unlinks = ctx.db.prepare("SELECT before FROM audit_log WHERE action = 'document.unlink' AND target_id = ?").all(rec.documentId);
  assert.equal(unlinks.length, 1);
  assert.equal(JSON.parse(unlinks[0].before).type, 'pays');

  // Both targets again: both links, nothing removed.
  await generateDocument(ctx, 'receipt', { ...fixtureInput('receipt'), references: [a.documentId, b.documentId] }, { documentId: rec.documentId });
  assert.deepEqual(rels(ctx, rec.documentId).filter(([t]) => t === 'pays').map(([, to]) => to), [a.documentId, b.documentId].sort());
}));
