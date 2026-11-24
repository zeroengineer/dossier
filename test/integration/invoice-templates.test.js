import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { getDocument, readRendition } from '../../src/services/documents.js';
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
