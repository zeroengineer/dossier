import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, readRendition } from '../../src/services/documents.js';
import { getEntity } from '../../src/services/entities.js';
import { generateDocument, previewDocument } from '../../src/services/generator.js';
import { listTemplateErrors, listTemplates } from '../../src/services/templates.js';
import { extractItems } from '../helpers/pdfText.js';
import { fixtureInput, withExampleCtx } from '../helpers/templateRender.js';

const items = async (ctx, id) => extractItems(readRendition(ctx, id, { kind: 'pdf' }).buffer);
const engagementOf = (ctx, id) => ctx.db.prepare('SELECT engagement_id FROM documents WHERE id = ?').get(id).engagement_id;
const SRC = join(import.meta.dirname, '..', '..', 'src', 'templates');

test('proposal and pricing-report load as built-ins without errors', () => withExampleCtx(async (ctx) => {
  const ids = listTemplates(ctx).map((t) => t.id);
  assert.ok(ids.includes('proposal') && ids.includes('pricing-report'));
  assert.deepEqual(listTemplateErrors(ctx), []);
}));

test('proposal: quotation numbers use {CODE} (engagement, else client, else the code field; one brand+year counter); party and engagement stored', () => withExampleCtx(async (ctx) => {
  const a = await generateDocument(ctx, 'proposal', fixtureInput('proposal'));
  const b = await generateDocument(ctx, 'proposal', { ...fixtureInput('proposal'), engagement: undefined, sections: undefined });
  const c = await generateDocument(ctx, 'proposal', { ...fixtureInput('proposal'), code: 'CUSTOM' });
  assert.deepEqual([a.number, b.number, c.number], ['ACM-Q-EXC26-2026-01', 'ACM-Q-EISS-2026-02', 'ACM-Q-CUSTOM-2026-03']);
  assert.deepEqual(a.warnings, []);
  const doc = getDocument(ctx, a.documentId);
  assert.deepEqual([doc.type, doc.party.type, doc.party.name, doc.docDate], ['Proposal', 'Client', 'Example Institute of Sample Studies', '2026-11-13']);
  assert.equal(engagementOf(ctx, a.documentId), getEntity(ctx, 'Example Conference 2026 - Sample College', { kind: 'engagement' }).id);
  assert.ok((await items(ctx, a.documentId)).some((i) => i.text === 'ACM-Q-EXC26-2026-01'));
  // Without an engagement the default cover subtitle ({event}) is left out, and the default sections need no event.
  assert.deepEqual(b.warnings, []);
  assert.match(readRendition(ctx, a.documentId, { kind: 'md' }).buffer.toString('utf8'), /\| ₹4,720.00 \| ₹94.40 \|/);
}));

test('pricing report: report series; previews list missing fields and warn about empty placeholders', () => withExampleCtx(async (ctx) => {
  const r = await generateDocument(ctx, 'pricing-report', fixtureInput('pricing-report'));
  assert.equal(r.number, 'ACM-REP-2026-001');
  assert.deepEqual(r.warnings, []);
  const doc = getDocument(ctx, r.documentId);
  assert.deepEqual([doc.type, doc.party.name], ['Pricing Report', 'Sample Society of Placeholders']);
  assert.equal(engagementOf(ctx, r.documentId), getEntity(ctx, 'Sample Annual Meet 2026', { kind: 'engagement' }).id);

  const p = await previewDocument(ctx, 'pricing-report', {});
  assert.deepEqual(p.missing.map((m) => m.name), ['client']);
  const w = await previewDocument(ctx, 'pricing-report', {
    ...fixtureInput('pricing-report'), engagement: undefined,
    sections: [{ title: 'Overview', blocks: [{ type: 'paragraph', text: 'Pricing for {event} at {venue}.' }] }],
  });
  assert.equal(w.ok, true);
  assert.deepEqual(w.warnings.map((x) => [x.code, x.name]), [['PLACEHOLDER_EMPTY', 'event'], ['PLACEHOLDER_EMPTY', 'venue']]);
  assert.match(readFileSync(w.renditions[2].path, 'utf8'), /Report Number: DRAFT/);
}));

test('a workspace template.json override keeps the module: own sections, stacked cover, bordered tables', () => withExampleCtx(async (ctx, home) => {
  const meta = JSON.parse(readFileSync(join(SRC, 'proposal', 'template.json'), 'utf8'));
  meta.params.cover.style = 'stacked';
  meta.params.frame = { table: { border: { color: '#d0d0d0', width: 0.35 }, row: { fills: ['#f4f4f4', '#ffffff'] } } };
  meta.params.headings = { ...meta.params.headings, subsection: '{title}', contentsSubsection: '{title}' };
  meta.params.sections = [
    { title: 'Private Overview', blocks: [{ type: 'paragraph', text: 'Workspace wording for {client}.' }],
      subsections: [{ title: 'Fee Component Breakdown', blocks: [{ type: 'custom', name: 'feeTable', data: { kind: 'delegatePaid', base: 2000 } }] }] },
    { title: 'Sign-off', blocks: [{ type: 'custom', name: 'signOff' }] },
  ];
  const dir = join(home, 'templates', 'proposal');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'template.json'), JSON.stringify(meta));
  const t = listTemplates(ctx).find((x) => x.id === 'proposal');
  assert.equal(t.source, 'workspace');
  const { sections, ...input } = fixtureInput('proposal');
  const r = await generateDocument(ctx, 'proposal', { ...input, projectContact: 'md' });
  const it = await items(ctx, r.documentId);
  const text = it.map((i) => i.text);
  assert.ok(text.includes('1. Private Overview') && text.includes('Fee Component Breakdown') && text.includes('₹2,095.51'));
  // Stacked cover: Submitted To / By and upper-case labels; one sign-off column when the contact is the signatory.
  assert.ok(text.includes('SUBMITTED TO') === false && text.includes('Submitted To') && text.includes('QUOTATION NUMBER'));
  assert.ok(text.includes('AUTHORIZED SIGNATORY') && !text.includes('PROJECT CONTACT'));
  const label = it.find((i) => i.text === 'PROPOSAL TYPE');
  assert.deepEqual([label.y, label.size], [580, 10]);
}));
