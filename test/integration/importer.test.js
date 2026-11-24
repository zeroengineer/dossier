import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpDir } from '../helpers/tmp.js';
import { makePdf } from '../helpers/pdf.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { seedEntities, findEntities, getEntity, upsertEntity } from '../../src/services/entities.js';
import { getDocument } from '../../src/services/documents.js';
import { peekNumber } from '../../src/services/numbering.js';
import { importFolder, parseCsv, folderEntityName } from '../../src/services/importer.js';
import { main } from '../../src/cli.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/import/', import.meta.url));
const SSP_MOU = '03 Clients/Events/Sample Society of Placeholders/MoU';
const EISS_INV = '03 Clients/Events/Example Institute of Sample Studies (EISS)/Invoices and Receipts';
const FW_PRICING = '03 Clients/Software and Services/Fictional Widgets LLP (FW)/Spring Launch 2026/Proposals and Pricing';

/** Snapshot of every file (path, size, sha256) under a folder. */
function treeState(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/**
 * A fresh workspace (the shipped example with its seeds) and a copy of the fixture vault, plus the files that cannot
 * live in git (dotfiles, node_modules, secrets) and a generated PDF.
 */
async function setup(fn, { csv = false } = {}) {
  const { dir, cleanup } = tmpDir('dossier-import-');
  let ctx;
  try {
    const home = initWorkspace(join(dir, 'ws'));
    const vault = join(dir, 'vault');
    cpSync(join(FIXTURES, 'vault'), vault, { recursive: true });
    if (csv) cpSync(join(FIXTURES, '_index.csv'), join(vault, '_index.csv'));
    writeFileSync(join(vault, '.DS_Store'), 'x');
    mkdirSync(join(vault, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(vault, 'node_modules', 'pkg', 'index.js'), '// fixture');
    mkdirSync(join(vault, '01 Company', 'tools'), { recursive: true });
    writeFileSync(join(vault, '01 Company', 'tools', 'package.json'), '{"name":"fixture"}');
    writeFileSync(join(vault, '01 Company', 'tools', 'make.js'), '// fixture');
    writeFileSync(join(vault, EISS_INV, 'signing.key'), 'not really a key (fixture)');
    writeFileSync(join(vault, '01 Company', 'notes.txt'), 'fixture -----BEGIN PRIVATE KEY----- fixture');
    writeFileSync(join(vault, FW_PRICING, 'pricing.pdf'), await makePdf(['PRICING REPORT  No. ACM-REP-2026-127\nPrepared for Fictional Widgets LLP. See also ACM-REP-2026-001.']));
    ctx = openContext({ home, user: 'tester', env: {} });
    seedEntities(ctx);
    return await fn({ ctx, home, vault });
  } finally {
    ctx?.close();
    cleanup();
  }
}

const docByPath = (summary, suffix) => summary.documents.find((d) => d.path.endsWith(suffix));
const count = (ctx, table) => ctx.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

function dbState(ctx) {
  const tables = ['documents', 'versions', 'renditions', 'blobs', 'document_text', 'entities', 'entity_aliases', 'entity_relations', 'sequences', 'audit_log', 'templates'];
  return {
    counts: Object.fromEntries(tables.map((t) => [t, count(ctx, t)])),
    sequences: ctx.db.prepare('SELECT * FROM sequences ORDER BY scope_key').all(),
    lastAudit: ctx.db.prepare('SELECT max(id) AS id FROM audit_log').get().id,
  };
}

test('folder import classifies, dedupes, parses numbers, flags conflicts, creates entities and skips what it must', () => setup(async ({ ctx, vault }) => {
  const before = treeState(vault);
  const s = await importFolder(ctx, { folder: vault });

  // Skips: dotfiles, node_modules, generator source (by name and by package.json), restricted, secrets.
  const skipped = Object.fromEntries(s.skipped.map((x) => [x.path, x.reason]));
  assert.equal(skipped['.DS_Store'], 'hidden file');
  assert.equal(skipped['node_modules/'], 'node_modules');
  assert.equal(skipped['09 Generator Source/'], 'generator source code');
  assert.match(skipped['01 Company/tools/'], /package\.json/);
  assert.match(skipped['10 Restricted - Security/'], /restricted/);
  assert.match(skipped[`${EISS_INV}/signing.key`], /^secret \(file extension \.key\)/);
  assert.match(skipped['01 Company/notes.txt'], /^secret \(content contains/);
  assert.equal(s.skipped.length, 7);

  // Dedupe: the identical MoU copy is not a second document.
  assert.equal(s.deduped, 1);
  assert.deepEqual(s.duplicates, [{ path: `${SSP_MOU}/2026-01-20_SSP_MoU.md`, of: `${SSP_MOU}/2026-01-20_SSP_MoU copy.md`, reason: 'identical copy' }]);

  // Types from leaf folders (routing table backwards), series and file names; legacy top-level names.
  const type = (suffix) => docByPath(s, suffix)?.type;
  assert.equal(type('ACM-DOC-2026-0007.md'), 'Board Resolution');
  assert.equal(type('Jordan Placeholder_Offer Letter.md'), 'Offer Letter');
  assert.equal(type('Casey Newhire_Relieving Letter.md'), 'Relieving Letter');
  assert.equal(type('2026-03-01_EISS_Invoice_ACM-2026-0131.md'), 'Invoice');
  assert.equal(type('2026-03-02_EISS_ACM-REC-2026-0135.md'), 'Receipt');
  assert.equal(type('2026-01-20_SSP_MoU copy.md'), 'MoU');
  assert.equal(type('2026-04-02_FW_ACM-Q-FW-2026-03.md'), 'Proposal');
  assert.equal(type('pricing.pdf'), 'Pricing Report');
  assert.equal(type('Acme Tickets Brochure.md'), 'Brochure');
  assert.equal(type('letter-template.md'), 'Template');
  assert.equal(type('bill-0042.txt'), 'Vendor Invoice');
  assert.equal(type('style-guide.md'), 'Reference');
  assert.equal(type('annual-filing.txt'), 'Other');
  assert.equal(type('id-card.txt'), 'Other');
  assert.equal(s.imported, 16);
  assert.equal(Object.values(s.byType).reduce((a, b) => a + b, 0), 16);
  assert.equal(s.byType.Invoice, 3);

  // Parties and entities: existing ones reused (by name or alias), new ones created with their bracketed alias.
  assert.equal(docByPath(s, 'bill-0042.txt').party, 'Example Sound and Light Co');
  assert.equal(docByPath(s, 'Acme Tickets Brochure.md').party, 'Acme Tickets');
  assert.equal(docByPath(s, '2026-03-01_EISS_Invoice_ACM-2026-0131.md').party, 'Example Institute of Sample Studies');
  assert.equal(docByPath(s, 'id-card.txt').party, 'Jordan Placeholder');
  assert.equal(docByPath(s, 'annual-filing.txt').party, null);
  assert.deepEqual(s.newEntities, [
    { kind: 'client', name: 'Fictional Widgets LLP' },
    { kind: 'engagement', name: 'Spring Launch 2026' },
    { kind: 'person', name: 'Casey Newhire' },
  ]);
  const fw = getEntity(ctx, 'FW', { kind: 'client' });
  assert.equal(fw.name, 'Fictional Widgets LLP');
  assert.ok(fw.relations.some((r) => r.role === 'belongs_to_business_line' && r.entity.name === 'Software and Services'));
  assert.ok(fw.relations.some((r) => r.role === 'engagement_of' && r.entity.name === 'Spring Launch 2026'));
  assert.equal(findEntities(ctx, { q: 'Example Institute of Sample Studies', kind: 'client' }).length, 1);

  // Sensitivity by folder.
  assert.equal(docByPath(s, 'id-card.txt').sensitivity, 'Confidential');
  assert.equal(docByPath(s, 'Casey Newhire_Relieving Letter.md').sensitivity, 'Confidential');
  assert.equal(docByPath(s, 'bill-0042.txt').sensitivity, 'Internal');

  // Numbers: file name first (with `/` written as `-`), then text; counters seeded forward; conflicts flagged.
  const nums = Object.fromEntries(s.numbers.map((n) => [n.path.split('/').pop(), `${n.series} ${n.number} ${n.from}`]));
  assert.equal(nums['pricing.pdf'], 'report ACM-REP-2026-127 text');
  assert.equal(nums['2026-04-02_FW_ACM-Q-FW-2026-03.md'], 'quotation ACM-Q-FW-2026-03 filename');
  assert.equal(nums['2026-03-02_EISS_ACM-REC-2026-0135.md'], 'receipt ACM-REC-2026-0135 filename');
  assert.equal(s.numbers.length, 7);
  assert.equal(peekNumber(ctx, 'invoice-main', { date: '2026-05-01' }).number, 'ACM-2026-0136');
  assert.equal(peekNumber(ctx, 'quotation', { date: '2026-05-01', code: 'FW' }).number, 'ACM-Q-FW-2026-04');
  assert.equal(peekNumber(ctx, 'report', { date: '2026-05-01' }).number, 'ACM-REP-2026-128');
  assert.equal(s.conflicts.length, 1);
  const conflict = s.conflicts[0];
  assert.equal(conflict.number, 'ACM-2026-0131');
  const first = docByPath(s, '2026-03-01_EISS_Invoice_ACM-2026-0131.md');
  assert.deepEqual(conflict.conflictsWith, [first.id]);
  const second = getDocument(ctx, docByPath(s, '2026-03-05_SSP_Invoice_ACM-2026-0131.md').id);
  assert.equal(second.numberConflict, true);
  assert.equal(getDocument(ctx, first.id).numberConflict, false);

  // Stored metadata: date from the name, client folder -> business line and engagement, source path on the version.
  const proposal = getDocument(ctx, docByPath(s, 'ACM-Q-FW-2026-03.md').id);
  assert.equal(proposal.docDate, '2026-04-02');
  assert.equal(proposal.party.name, 'Fictional Widgets LLP');
  assert.equal(proposal.numberSeries, 'quotation');
  assert.equal(proposal.issuingBrandId, 'acme');
  const other = getDocument(ctx, docByPath(s, 'annual-filing.txt').id);
  const version = ctx.db.prepare('SELECT input_json, note FROM versions WHERE document_id = ?').get(other.id);
  assert.deepEqual(JSON.parse(version.input_json), { import: { source_path: '07 Placeholder Holdings LLP/annual-filing.txt', source_folder: '07 Placeholder Holdings LLP' } });
  assert.equal(version.note, 'Imported from 07 Placeholder Holdings LLP/annual-filing.txt');
  const engagementOf = ctx.db.prepare('SELECT e.display_name AS n FROM documents d JOIN entities e ON e.id = d.engagement_id WHERE d.id = ?').get(proposal.id);
  assert.equal(engagementOf.n, 'Spring Launch 2026');

  // The source folder is untouched.
  assert.deepEqual(treeState(vault), before);
}));

test('a second run imports nothing new (idempotent)', () => setup(async ({ ctx, vault }) => {
  const first = await importFolder(ctx, { folder: vault });
  const state = dbState(ctx);
  const again = await importFolder(ctx, { folder: vault });
  assert.equal(again.imported, 0);
  assert.equal(again.existing, first.imported + first.deduped);
  assert.deepEqual(again.newEntities, []);
  assert.deepEqual(again.conflicts, []);
  assert.deepEqual(dbState(ctx), state);
}));

test('--dry-run writes nothing and reports what a real run would do', () => setup(async ({ ctx, home, vault }) => {
  const dbBefore = dbState(ctx);
  const blobsBefore = treeState(join(home, 'data', 'blobs'));
  const dry = await importFolder(ctx, { folder: vault, dryRun: true });
  assert.deepEqual(dbState(ctx), dbBefore);
  assert.deepEqual(treeState(join(home, 'data', 'blobs')), blobsBefore);
  assert.equal(dry.dryRun, true);
  assert.ok(dry.documents.every((d) => d.id === null));

  const real = await importFolder(ctx, { folder: vault });
  const strip = (x) => ({ ...x, dryRun: null, documents: x.documents.map((d) => ({ ...d, id: null })), conflicts: x.conflicts.map((c) => ({ ...c, conflictsWith: c.conflictsWith.length })) });
  assert.deepEqual(strip(dry), strip(real));
}));

test('index CSV import: empty vault_path rows are duplicates, [from …] names import, md5 drift warns, skip rules apply', () => setup(async ({ ctx, vault }) => {
  const s = await importFolder(ctx, { folder: vault, index: join(vault, '_index.csv') });
  assert.equal(s.files, 7);
  assert.equal(s.imported, 4);
  assert.equal(s.deduped, 1);
  assert.match(s.duplicates[0].reason, /^identical copy of /);
  assert.deepEqual(s.skipped.map((x) => x.reason), ['restricted folder (never imported)', 'file not found']);
  assert.deepEqual(s.warnings.map((w) => w.path.split('/').pop()), ['2026-03-05_SSP_Invoice_ACM-2026-0131.md']);
  const from = docByPath(s, '0132 [from Old Drive].md');
  assert.equal(from.number, 'ACM-2026-0132');
  const doc = getDocument(ctx, from.id);
  assert.equal(doc.title, '2026-03-07_SSP_Invoice_ACM-2026-0132');
  assert.equal(doc.type, 'Invoice');
  assert.equal(s.conflicts.length, 1);
  const v = ctx.db.prepare('SELECT input_json FROM versions WHERE document_id = ?').get(from.id);
  assert.equal(JSON.parse(v.input_json).import.index_note, 'name clash: renamed [from Old Drive]');
  // Re-running the index imports nothing new.
  const again = await importFolder(ctx, { folder: vault, index: join(vault, '_index.csv') });
  assert.equal(again.imported, 0);
}, { csv: true }));

test('a legacy top-level folder named after a known group entity files under that entity', () => setup(async ({ ctx, vault }) => {
  upsertEntity(ctx, { kind: 'group_entity', name: 'Placeholder Holdings LLP' });
  const s = await importFolder(ctx, { folder: vault, dryRun: true });
  const d = docByPath(s, 'annual-filing.txt');
  assert.equal(d.party, 'Placeholder Holdings LLP');
  assert.equal(d.partyKind, 'group_entity');
}));

test('sensitivity is configurable and a user below it gets the file skipped', () => setup(async ({ ctx, vault }) => {
  const s = await importFolder(ctx, { folder: vault, dryRun: true, sensitivity: { default: 'Public' } });
  assert.equal(docByPath(s, 'bill-0042.txt').sensitivity, 'Public');
  assert.equal(docByPath(s, 'id-card.txt').sensitivity, 'Confidential');
  ctx.user = { ...ctx.user, clearance: 'Internal' };
  const low = await importFolder(ctx, { folder: vault, dryRun: true });
  assert.ok(low.skipped.some((x) => x.path.endsWith('id-card.txt') && /needs Confidential clearance/.test(x.reason)));
  await assert.rejects(importFolder(ctx, { folder: vault, sensitivity: { default: 'Restricted' } }), (e) => e.code === 'INVALID_INPUT');
}));

test('dossier import prints the summary table; --dry-run writes nothing', () => setup(async ({ ctx, home, vault }) => {
  ctx.close();
  const out = { text: '', write(s) { this.text += s; return true; } };
  const err = { text: '', write(s) { this.text += s; return true; } };
  const env = { DOSSIER_HOME: home, DOSSIER_USER: 'tester' };
  assert.equal(await main(['import', vault, '--dry-run'], { stdout: out, stderr: err, env, cwd: home }), 0, err.text);
  assert.match(out.text, /dry run: nothing was written/);
  assert.match(out.text, /Would import\s+16/);
  assert.match(out.text, /Number conflicts\s+1/);
  assert.match(out.text, /Invoice\s+3/);
  assert.match(out.text, /ACM-2026-0131/);
  const check = openContext({ home, user: 'tester', env: {} });
  try { assert.equal(count(check, 'documents'), 0); } finally { check.close(); }

  out.text = '';
  assert.equal(await main(['import', vault, '--brand', 'acme'], { stdout: out, stderr: err, env, cwd: home }), 0, err.text);
  assert.match(out.text, /Imported\s+16/);
  err.text = '';
  assert.equal(await main(['import', vault, '--brand', 'nope'], { stdout: out, stderr: err, env, cwd: home }), 1);
  assert.match(err.text, /No brand "nope"/);
  assert.equal(await main(['import'], { stdout: out, stderr: err, env, cwd: home }), 1);
}));

test('parseCsv and folderEntityName', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\nlast,\n'), [['a', 'b'], ['x, y', 'say "hi"'], ['last', '']]);
  assert.deepEqual(folderEntityName('Example Institute (EI)'), { name: 'Example Institute', aliases: ['EI'] });
  assert.deepEqual(folderEntityName('  Plain   Name '), { name: 'Plain Name', aliases: [] });
});
