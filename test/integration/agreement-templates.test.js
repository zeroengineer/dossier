import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, readRendition } from '../../src/services/documents.js';
import { getEntity, upsertEntity } from '../../src/services/entities.js';
import { generateDocument, previewDocument } from '../../src/services/generator.js';
import { getTemplate, listTemplateErrors, listTemplates } from '../../src/services/templates.js';
import { extractItems } from '../helpers/pdfText.js';
import { fixtureInput, withExampleCtx } from '../helpers/templateRender.js';

const pdfText = async (buf) => (await extractItems(buf)).map((i) => i.text).join(' ');
const md = (ctx, id) => readRendition(ctx, id, { kind: 'md' }).buffer.toString('utf8');

test('mou and board-resolution load as built-ins without errors', () => withExampleCtx(async (ctx) => {
  const ids = listTemplates(ctx).map((t) => t.id);
  assert.ok(ids.includes('mou') && ids.includes('board-resolution'));
  assert.deepEqual(listTemplateErrors(ctx), []);
  const t = await getTemplate(ctx, 'mou');
  assert.equal(typeof t.body, 'string');
  assert.deepEqual(Object.keys(t.bodies), ['event']);
}));

test('mou: numbered from the brand series, party and engagement recorded, Markdown is the filled body', () => withExampleCtx(async (ctx) => {
  const org = await generateDocument(ctx, 'mou', fixtureInput('mou'));
  const ev = await generateDocument(ctx, 'mou', {
    ...fixtureInput('mou'), variant: 'event', partner: 'Sample Society of Placeholders', engagement: 'Sample Annual Meet 2026',
  });
  assert.deepEqual([org.number, ev.number], ['ACM-DOC-2026-0001', 'ACM-DOC-2026-0002']);
  const doc = getDocument(ctx, org.documentId);
  assert.deepEqual([doc.type, doc.party.type, doc.party.name, doc.sensitivity, doc.docDate],
    ['MoU', 'Client', 'Example Institute of Sample Studies', 'Confidential', '2026-09-25']);
  const engagement = ctx.db.prepare('SELECT engagement_id FROM documents WHERE id = ?').get(ev.documentId).engagement_id;
  assert.equal(engagement, getEntity(ctx, 'Sample Annual Meet 2026', { kind: 'engagement' }).id);

  const orgMd = md(ctx, org.documentId);
  assert.match(orgMd, /^# MEMORANDUM OF UNDERSTANDING\n\nReference: ACM-DOC-2026-0001\n/);
  assert.match(orgMd, /# ORGANISATION DETAILS \(FOR REFERENCE\)/);
  const evMd = md(ctx, ev.documentId);
  assert.match(evMd, /# EVENT DETAILS/);
  assert.match(evMd, /\| Event \| Sample Annual Meet 2026 \|/);
  const text = await pdfText(readRendition(ctx, ev.documentId, { kind: 'pdf' }).buffer);
  assert.match(text, /Reference: ACM-DOC-2026-0002/);
  assert.doesNotMatch(text, /DRAFT/);
  assert.match(readRendition(ctx, org.documentId, { kind: 'html' }).buffer.toString('utf8'), /mou-signatures/);
}));

test('board resolution: generated with the brand series; previews list missing fields', () => withExampleCtx(async (ctx) => {
  const r = await generateDocument(ctx, 'board-resolution', fixtureInput('board-resolution'));
  assert.equal(r.number, 'ACM-DOC-2026-0001');
  const doc = getDocument(ctx, r.documentId);
  assert.deepEqual([doc.type, doc.party, doc.title], ['Board Resolution', null, 'Board resolution']);
  const text = await pdfText(readRendition(ctx, r.documentId, { kind: 'pdf' }).buffer);
  assert.match(text, /Ref: ACM-DOC-2026-0001/);
  assert.match(text, /Example Bank Limited/);
  const p = await previewDocument(ctx, 'board-resolution', {});
  assert.deepEqual(p.missing.map((m) => m.name).sort(), ['bank', 'directors']);
  const m = await previewDocument(ctx, 'mou', {});
  assert.deepEqual(m.missing.map((x) => x.name).sort(), ['feePercent', 'partner', 'partnerAddress', 'partnerName', 'service']);
  const ok = await previewDocument(ctx, 'mou', fixtureInput('mou'));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.warnings, []);
  assert.match(readFileSync(ok.renditions[2].path, 'utf8'), /Reference: DRAFT/);
}));

test('a workspace override with only body.md keeps the built-in module and meta (private MoU text)', () => withExampleCtx(async (ctx, home) => {
  const builtin = listTemplates(ctx).find((t) => t.id === 'mou');
  const dir = join(home, 'templates', 'mou');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'body.md'), [
    '# PRIVATE AGREEMENT', '', 'Between **{{print.companyUpper}}** and **{{print.partnerUpper}}**.', '', '---', '',
    '# 1. TERMS', '', 'Fee: **{{print.feePercent}}%**.', '', '## For {{print.companyUpper}}', '', 'Name: {{signatory.name}}', '',
    '## For {{print.partnerUpper}}', '', 'Name:', '',
  ].join('\n'));
  const t = listTemplates(ctx).find((x) => x.id === 'mou');
  assert.deepEqual([t.source, t.title, t.inherits], ['workspace', builtin.title, builtin.path]);
  assert.notEqual(t.hash, builtin.hash);
  const r = await generateDocument(ctx, 'mou', fixtureInput('mou'));
  assert.match(md(ctx, r.documentId), /^# PRIVATE AGREEMENT\n\nBetween \*\*ACME EVENTS PRIVATE LIMITED\*\* and \*\*EXAMPLE INSTITUTE OF SAMPLE STUDIES\*\*\./);
  const text = await pdfText(readRendition(ctx, r.documentId, { kind: 'pdf' }).buffer);
  assert.match(text, /PRIVATE AGREEMENT/);
  assert.match(text, /Authorized Signatory/);
  assert.doesNotMatch(text, /PURPOSE/);
  const gen = ctx.db.prepare("SELECT attrs FROM document_relations WHERE from_doc = ? AND type = 'generated_from'").get(r.documentId);
  assert.match(gen.attrs, /"source":"workspace"/);
  // The event variant still uses the built-in event body (bodies fall back file by file).
  const ev = await generateDocument(ctx, 'mou', { ...fixtureInput('mou'), variant: 'event', engagement: 'Example Fest 2026 - Sample College' });
  assert.match(md(ctx, ev.documentId), /# EVENT DETAILS/);
}));

test('empty body placeholders are returned as PLACEHOLDER_EMPTY warnings by preview and generate', () => withExampleCtx(async (ctx, home) => {
  const clean = await generateDocument(ctx, 'mou', fixtureInput('mou'));
  assert.deepEqual(clean.warnings, [], 'optional values are guarded in the shipped bodies');
  const ev = await generateDocument(ctx, 'mou', { ...fixtureInput('mou'), variant: 'event', engagement: 'Sample Annual Meet 2026' });
  assert.deepEqual(ev.warnings, []);
  assert.doesNotMatch(md(ctx, ev.documentId), /\| Venue \|/, 'empty event rows are left out');
  const dir = join(home, 'templates', 'mou');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'body.md'), '# MoU\n\nWith {{partnerName}} at {{partnerOffice}}, signed by {{partnerSignatory.name}} and {{partnerOffice}}.\n');
  const p = await previewDocument(ctx, 'mou', fixtureInput('mou'));
  assert.equal(p.ok, true);
  const expected = [
    { code: 'PLACEHOLDER_EMPTY', name: 'partnerOffice', message: '{{partnerOffice}} has no value and prints as empty text' },
    { code: 'PLACEHOLDER_EMPTY', name: 'partnerSignatory.name', message: '{{partnerSignatory.name}} has no value and prints as empty text' },
  ];
  assert.deepEqual(p.warnings, expected);
  const g = await generateDocument(ctx, 'mou', fixtureInput('mou'));
  assert.deepEqual(g.warnings, expected);
  const b = await generateDocument(ctx, 'board-resolution', fixtureInput('board-resolution'));
  assert.deepEqual(b.warnings, [], 'templates without a body have no placeholder warnings');
}));

test('mou: a partner without an address is missing; a brand without an address fails print', () => withExampleCtx(async (ctx) => {
  upsertEntity(ctx, { kind: 'client', name: 'Addressless Example Club' });
  const p = await previewDocument(ctx, 'mou', { ...fixtureInput('mou'), partner: 'Addressless Example Club' });
  assert.deepEqual(p.missing.map((m) => m.name), ['partnerAddress']);
  const ok = await previewDocument(ctx, 'mou', { ...fixtureInput('mou'), partner: 'Addressless Example Club', partnerAddress: 'Club House, Example Town' });
  assert.equal(ok.ok, true);
  const brand = ctx.ws.brands.get('acme');
  ctx.ws.brands.set('acme', { ...brand, addresses: { business: [' '] } });
  try {
    const r = await previewDocument(ctx, 'mou', fixtureInput('mou'));
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => e.name), ['print']);
    assert.match(r.errors[0].message, /no registered or business address/);
  } finally {
    ctx.ws.brands.set('acme', brand);
  }
}));
