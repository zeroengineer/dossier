import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { openContext } from '../../src/context.js';
import { getDocument, readRendition } from '../../src/services/documents.js';
import { getEntity, upsertEntity } from '../../src/services/entities.js';
import { generateDocument, previewDocument } from '../../src/services/generator.js';
import { listTemplateErrors, listTemplates } from '../../src/services/templates.js';
import { extractItems } from '../helpers/pdfText.js';
import { fixtureInput, withExampleCtx } from '../helpers/templateRender.js';

sharp.cache(false);
const STATEMENTS = ['employee-final-settlement', 'ticketing-settlement-statement', 'client-final-settlement', 'remittance-statement', 'expense-statement'];
const pdfText = async (buf) => (await extractItems(buf)).map((i) => i.text).join(' ');
const rels = (ctx, id) => ctx.db.prepare("SELECT type, to_doc FROM document_relations WHERE from_doc = ? AND type != 'generated_from' ORDER BY to_doc").all(id)
  .map((r) => [r.type, r.to_doc]);
const engagementOf = (ctx, id) => ctx.db.prepare('SELECT engagement_id FROM documents WHERE id = ?').get(id).engagement_id;

test('the statement templates load as built-ins without errors', () => withExampleCtx(async (ctx) => {
  const ids = listTemplates(ctx).map((t) => t.id);
  for (const id of STATEMENTS) assert.ok(ids.includes(id), id);
  assert.deepEqual(listTemplateErrors(ctx), []);
}));

test('client final settlement: FSS/{CLIENT}/{YYYY}/{###} per client, settles invoices, stores the engagement', () => withExampleCtx(async (ctx) => {
  const inv1 = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const inv2 = await generateDocument(ctx, 'invoice', fixtureInput('invoice'));
  const a = await generateDocument(ctx, 'client-final-settlement', { ...fixtureInput('client-final-settlement'), invoices: [inv2.documentId, inv1.documentId] });
  const b = await generateDocument(ctx, 'client-final-settlement', fixtureInput('client-final-settlement'));
  const other = await generateDocument(ctx, 'client-final-settlement', {
    ...fixtureInput('client-final-settlement'), client: 'Sample Society of Placeholders', engagement: 'Sample Annual Meet 2026', issuedTo: undefined,
  });
  const coded = await generateDocument(ctx, 'client-final-settlement', { ...fixtureInput('client-final-settlement'), clientCode: 'EXF26' });
  assert.deepEqual([a.number, b.number, other.number, coded.number], ['FSS/EISS/2026/001', 'FSS/EISS/2026/002', 'FSS/SSP/2026/001', 'FSS/EXF26/2026/001']);

  const doc = getDocument(ctx, a.documentId);
  assert.equal(doc.type, 'Settlement Statement');
  assert.equal(doc.party.type, 'Client');
  assert.equal(doc.party.name, 'Example Institute of Sample Studies');
  assert.equal(doc.amountMinor, 1404950);
  assert.equal(doc.docDate, '2026-07-13');
  assert.deepEqual(rels(ctx, a.documentId), [['settles', inv1.documentId], ['settles', inv2.documentId]].sort((x, y) => x[1].localeCompare(y[1])));
  assert.deepEqual(rels(ctx, b.documentId), []);
  assert.equal(engagementOf(ctx, a.documentId), getEntity(ctx, 'Example Fest 2026 - Sample College', { kind: 'engagement' }).id);
  assert.equal(engagementOf(ctx, other.documentId), getEntity(ctx, 'Sample Annual Meet 2026', { kind: 'engagement' }).id);

  const text = await pdfText(readRendition(ctx, a.documentId, { kind: 'pdf' }).buffer);
  assert.match(text, /Doc No\.: FSS\/EISS\/2026\/001/);
  assert.doesNotMatch(text, /DRAFT/);
  const md = readRendition(ctx, a.documentId, { kind: 'md' }).buffer.toString('utf8');
  assert.match(md, /FSS\/EISS\/2026\/001/);
}));

test('the other statements are unnumbered; amounts, parties, engagement and pays relation are recorded', () => withExampleCtx(async (ctx) => {
  const emp = await generateDocument(ctx, 'employee-final-settlement', fixtureInput('employee-final-settlement'));
  const tick = await generateDocument(ctx, 'ticketing-settlement-statement', fixtureInput('ticketing-settlement-statement'));
  const rec = await generateDocument(ctx, 'receipt', fixtureInput('receipt'));
  const rem = await generateDocument(ctx, 'remittance-statement', { ...fixtureInput('remittance-statement'), references: [rec.documentId] });
  const exp = await generateDocument(ctx, 'expense-statement', fixtureInput('expense-statement'));
  assert.deepEqual([emp.number, tick.number, rem.number, exp.number], [null, null, null, null]);

  const e = getDocument(ctx, emp.documentId);
  assert.deepEqual([e.type, e.party.type, e.party.name, e.amountMinor, e.sensitivity], ['Final Settlement', 'Person', 'Jordan Placeholder', 1080000, 'Confidential']);
  const t = getDocument(ctx, tick.documentId);
  assert.deepEqual([t.type, t.party.name, t.amountMinor], ['Ticketing Settlement Statement', 'Sample Society of Placeholders', 5389978]);
  assert.equal(engagementOf(ctx, tick.documentId), getEntity(ctx, 'Sample Annual Meet 2026', { kind: 'engagement' }).id);
  assert.equal(getDocument(ctx, rem.documentId).amountMinor, 50000000);
  assert.deepEqual(rels(ctx, rem.documentId), [['pays', rec.documentId]]);
  assert.equal(getDocument(ctx, exp.documentId).amountMinor, 795600);
  assert.equal(engagementOf(ctx, emp.documentId), null);

  for (const id of [emp.documentId, tick.documentId, rem.documentId, exp.documentId]) {
    const text = await pdfText(readRendition(ctx, id, { kind: 'pdf' }).buffer);
    assert.doesNotMatch(text, /DRAFT|Ref:|Doc No\.|Reference:/, id);
  }
}));

test('previews list missing fields, then render drafts', () => withExampleCtx(async (ctx) => {
  const r = await previewDocument(ctx, 'ticketing-settlement-statement', { date: '2026-11-05' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.name).sort(), ['client', 'event', 'issuedTo', 'tickets']);
  const c = await previewDocument(ctx, 'client-final-settlement', { client: 'Example Institute of Sample Studies' });
  assert.deepEqual(c.missing.map((m) => m.name).sort(), ['event', 'serviceFee']);
  for (const id of STATEMENTS) {
    const ok = await previewDocument(ctx, id, fixtureInput(id));
    assert.equal(ok.ok, true, id);
    assert.deepEqual(ok.renditions.map((x) => x.kind), ['pdf', 'html', 'md']);
  }
  const draft = await previewDocument(ctx, 'client-final-settlement', fixtureInput('client-final-settlement'));
  assert.match(await pdfText(readFileSync(draft.renditions[0].path)), /Doc No\.: DRAFT/);
}));

test('brand templateParams change statement wording per workspace; a mapped series numbers the expense statement', () => withExampleCtx(async (_ctx, home) => {
  const file = join(home, 'brands', 'acme', 'brand.json');
  const brand = JSON.parse(readFileSync(file, 'utf8'));
  brand.series['expense-statement'] = 'report';
  brand.templateParams = {
    'expense-statement': { title: 'STATEMENT OF EXPENSES', salutation: 'Dear Team,' },
    'employee-final-settlement': { title: 'FULL AND FINAL SETTLEMENT' },
  };
  writeFileSync(file, JSON.stringify(brand, null, 2));
  const ctx = openContext({ home, user: 'demo', dbFile: ':memory:', env: {} });
  try {
    const seeds = JSON.parse(readFileSync(join(home, 'seeds', 'entities.json'), 'utf8'));
    for (const e of seeds.entities.filter((x) => ['client', 'person', 'engagement'].includes(x.kind))) upsertEntity(ctx, e);
    const exp = await generateDocument(ctx, 'expense-statement', fixtureInput('expense-statement'));
    assert.equal(exp.number, 'ACM-REP-2026-001');
    const text = await pdfText(readRendition(ctx, exp.documentId, { kind: 'pdf' }).buffer);
    assert.match(text, /STATEMENT OF EXPENSES/);
    assert.match(text, /Ref: ACM-REP-2026-001/);
    assert.match(text, /Dear Team,/);
    const emp = await generateDocument(ctx, 'employee-final-settlement', fixtureInput('employee-final-settlement'));
    assert.match(await pdfText(readRendition(ctx, emp.documentId, { kind: 'pdf' }).buffer), /FULL AND FINAL SETTLEMENT/);
  } finally {
    ctx.close();
  }
}));
