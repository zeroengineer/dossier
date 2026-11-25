import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
import { importFolder, parseCsv, folderEntityName, isRestrictedName } from '../../src/services/importer.js';
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
  assert.equal(skipped['.DS_Store'], undefined, '.DS_Store files are counted, not listed');
  assert.equal(s.ignoredDsStore, 1);
  assert.equal(skipped['node_modules/'], 'node_modules');
  assert.equal(skipped['09 Generator Source/'], 'generator source code');
  assert.match(skipped['01 Company/tools/'], /package\.json/);
  assert.match(skipped['10 Restricted - Security/'], /restricted/);
  assert.match(skipped[`${EISS_INV}/signing.key`], /^secret \(file extension \.key\)/);
  assert.match(skipped['01 Company/notes.txt'], /^secret \(content contains/);
  assert.equal(s.skipped.length, 6);

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
  // The name says "pricing"; the number's series (report) has a type containing it, which wins.
  assert.equal(type('pricing.pdf'), 'Pricing Report');
  assert.equal(docByPath(s, 'pricing.pdf').typeFrom, 'series');
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
  // No date in its text or name: the file's modification time, recorded as such.
  assert.deepEqual(JSON.parse(version.input_json), { import: { source_path: '07 Placeholder Holdings LLP/annual-filing.txt', source_folder: '07 Placeholder Holdings LLP', date_source: 'mtime' } });
  assert.equal(version.note, 'Imported from 07 Placeholder Holdings LLP/annual-filing.txt (date from file time)');
  const mtime = statSync(join(vault, '07 Placeholder Holdings LLP/annual-filing.txt')).mtime;
  const localDay = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`;
  assert.equal(other.docDate, localDay);
  const named = ctx.db.prepare('SELECT input_json, note FROM versions WHERE document_id = ?').get(proposal.id);
  assert.equal(JSON.parse(named.input_json).import.date_source, 'filename');
  assert.match(named.note, /\(date from file name\)$/);
  assert.deepEqual(s.dates, { 'text-labelled': 0, 'text-first': 0, filename: 9, mtime: 7, none: 0 });
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

// ---------- fix round 1: no way past the skip rules ----------

/** Write an index CSV (rows of vault_path, note) into `dir`. */
function writeIndex(dir, rows) {
  const lines = ['original_path,vault_path,vault_folder,md5,size_bytes,note', ...rows.map(([p, note = '']) => `x,"${p}",,,,${note}`)];
  writeFileSync(join(dir, '_index.csv'), `${lines.join('\n')}\n`);
  return join(dir, '_index.csv');
}

test('CSV paths outside the import root (absolute or with ..) are refused', () => setup(async ({ ctx, vault }) => {
  const outside = join(vault, '..', 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret-plan.md'), '# outside the root (fixture)');
  const index = writeIndex(vault, [
    [join(outside, 'secret-plan.md')],
    ['../outside/secret-plan.md'],
    ['03 Clients/../../outside/secret-plan.md'],
    ['05 Templates/letter-template.md'],
  ]);
  const s = await importFolder(ctx, { folder: vault, index });
  assert.deepEqual(s.skipped.map((x) => x.reason), ['outside import root', 'outside import root', 'outside import root']);
  assert.equal(s.imported, 1);
  assert.equal(count(ctx, 'documents'), 1);
}));

test('CSV rows that are symbolic links, or whose folder links outside the root, are refused', () => setup(async ({ ctx, vault }) => {
  const outside = join(vault, '..', 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'elsewhere.md'), '# outside the root (fixture)');
  symlinkSync(join(outside, 'elsewhere.md'), join(vault, '05 Templates', 'linked.md'));
  symlinkSync(outside, join(vault, '08 References', 'linked-folder'));
  symlinkSync(join(vault, '10 Restricted - Security'), join(vault, '08 References', 'inner-link'));
  const index = writeIndex(vault, [
    ['05 Templates/linked.md'],
    ['08 References/linked-folder/elsewhere.md'],
    ['08 References/inner-link/vault-notes.txt'],
  ]);
  const s = await importFolder(ctx, { folder: vault, index });
  assert.deepEqual(s.skipped.map((x) => x.reason), ['symbolic link', 'outside import root', 'restricted folder (never imported)']);
  assert.equal(s.imported, 0);
  assert.equal(count(ctx, 'documents'), 0);
}));

test('a Restricted folder below the top level is never imported (folder and CSV mode)', () => setup(async ({ ctx, vault }) => {
  const nested = [
    '03 Clients/Events/Sample Society of Placeholders/10 Restricted/payroll.txt',
    '02 People/Restricted \u2013 Payroll/salary.txt',
    '01 Company/Restricted - Security/Security/token-notes.txt',
  ];
  for (const p of nested) {
    mkdirSync(join(vault, p, '..'), { recursive: true });
    writeFileSync(join(vault, p), `restricted fixture ${p}`);
  }
  const s = await importFolder(ctx, { folder: vault, dryRun: true });
  for (const p of nested) assert.ok(!s.documents.some((d) => d.path === p), p);
  const reasons = Object.fromEntries(s.skipped.map((x) => [x.path, x.reason]));
  assert.equal(reasons['03 Clients/Events/Sample Society of Placeholders/10 Restricted/'], 'restricted folder (never imported)');
  assert.equal(reasons['02 People/Restricted \u2013 Payroll/'], 'restricted folder (never imported)');
  assert.equal(reasons['01 Company/Restricted - Security/'], 'restricted folder (never imported)');

  const csv = await importFolder(ctx, { folder: vault, index: writeIndex(vault, nested.map((p) => [p])) });
  assert.deepEqual(csv.skipped.map((x) => x.reason), nested.map(() => 'restricted folder (never imported)'));
  assert.equal(count(ctx, 'documents'), 0);
}));

test('a "Scripts" folder of documents imports; src/scripts folders with code are skipped', () => setup(async ({ ctx, vault }) => {
  mkdirSync(join(vault, '08 References', 'Scripts'));
  writeFileSync(join(vault, '08 References', 'Scripts', 'event-host-script.md'), '# Host script (fixture)');
  mkdirSync(join(vault, '01 Company', 'scripts'));
  writeFileSync(join(vault, '01 Company', 'scripts', 'run.py'), '# fixture');
  mkdirSync(join(vault, '01 Company', 'src'));
  writeFileSync(join(vault, '01 Company', 'src', 'make.mjs'), '// fixture');
  const s = await importFolder(ctx, { folder: vault, dryRun: true });
  assert.ok(docByPath(s, 'Scripts/event-host-script.md'));
  const reasons = Object.fromEntries(s.skipped.map((x) => [x.path, x.reason]));
  assert.equal(reasons['01 Company/scripts/'], 'generator source code');
  assert.equal(reasons['01 Company/src/'], 'generator source code');
}));

test('a source path imported before with other bytes is reported as SOURCE_CHANGED', () => setup(async ({ ctx, vault }) => {
  await importFolder(ctx, { folder: vault });
  const rel = '08 References/style-guide.md';
  appendFileSync(join(vault, rel), 'edited after the first import (fixture)\n');
  const s = await importFolder(ctx, { folder: vault });
  assert.equal(s.imported, 1);
  const w = s.warnings.find((x) => x.path === rel);
  assert.equal(w.code, 'SOURCE_CHANGED');
  assert.match(w.message, /^SOURCE_CHANGED: imported before as DOC-\d{6}/);
}));

test('folder mode skips root index/spec files and counts .DS_Store files', () => setup(async ({ ctx, vault }) => {
  writeFileSync(join(vault, '_index.csv'), 'original_path,vault_path\n');
  writeFileSync(join(vault, 'VAULT_HIERARCHY.md'), '# spec (fixture)');
  writeFileSync(join(vault, '05 Templates', '.DS_Store'), 'x');
  writeFileSync(join(vault, '05 Templates', '_notes.csv'), 'a,b\n');
  const s = await importFolder(ctx, { folder: vault, dryRun: true });
  const reasons = Object.fromEntries(s.skipped.map((x) => [x.path, x.reason]));
  assert.equal(reasons['_index.csv'], 'index/spec file');
  assert.equal(reasons['VAULT_HIERARCHY.md'], 'index/spec file');
  assert.ok(docByPath(s, '05 Templates/_notes.csv'), 'only root-level files are index/spec files');
  assert.equal(s.ignoredDsStore, 2);
}));

test('renditions.blob_sha256 is indexed (the importer looks files up by hash)', () => setup(async ({ ctx }) => {
  const indexes = ctx.db.prepare("SELECT name FROM pragma_index_list('renditions')").all().map((r) => r.name);
  assert.ok(indexes.includes('renditions_blob'));
  const cols = ctx.db.prepare("SELECT name FROM pragma_index_info('renditions_blob')").all().map((r) => r.name);
  assert.deepEqual(cols, ['blob_sha256']);
}));

// ---------- fix round 2 ----------

test('Restricted is matched as a word after format characters and a number prefix', () => setup(async ({ ctx, vault }) => {
  const restricted = ['Restricted-Security', 'Restricted_Security', 'Restricted Security', 'Restricted (HR)', 'Restricted Files',
    'Restricted\u200B', '\u200B07 Restricted', '12. RESTRICTED', 'Restricted\u2013Payroll', '\uFF32estricted'];
  const allowed = ['Unrestricted Templates', 'Restrictedness Notes'];
  for (const n of restricted) assert.equal(isRestrictedName(n), true, n);
  for (const n of allowed) assert.equal(isRestrictedName(n), false, n);
  for (const n of [...restricted, ...allowed]) {
    mkdirSync(join(vault, '08 References', n), { recursive: true });
    writeFileSync(join(vault, '08 References', n, 'file.md'), `# ${n} (fixture)`);
  }
  const s = await importFolder(ctx, { folder: vault, dryRun: true });
  for (const n of restricted) assert.ok(!s.documents.some((d) => d.path === `08 References/${n}/file.md`), n);
  for (const n of allowed) assert.ok(s.documents.some((d) => d.path === `08 References/${n}/file.md`), n);
  const csv = await importFolder(ctx, { folder: vault, dryRun: true, index: writeIndex(vault, restricted.map((n) => [`08 References/${n}/file.md`])) });
  assert.deepEqual(csv.skipped.map((x) => x.reason), restricted.map(() => 'restricted folder (never imported)'));
}));

test('an absolute CSV path under the resolved root is accepted when the root was given through an alias', () => setup(async ({ ctx, vault }) => {
  // On macOS the temp folder is /var/... and resolves to /private/var/...; elsewhere both spellings are the same.
  const real = realpathSync(vault);
  const index = writeIndex(vault, [[join(real, '05 Templates', 'letter-template.md')], [join(vault, '08 References', 'style-guide.md')]]);
  const s = await importFolder(ctx, { folder: vault, index });
  assert.deepEqual(s.skipped, []);
  assert.equal(s.imported, 2);
  assert.equal(docByPath(s, 'letter-template.md').path, '05 Templates/letter-template.md');
  assert.equal(docByPath(s, 'letter-template.md').type, 'Template');
}));

// ---------- import accuracy: --only, type keywords, dates from the document ----------

/**
 * A fresh workspace (with a local type keyword in workspace.json) and a vault of fake PDFs whose text carries type
 * phrases and dates, plus one text file for --only.
 */
async function setupAccuracy(fn) {
  const { dir, cleanup } = tmpDir('dossier-import-acc-');
  let ctx;
  try {
    const home = initWorkspace(join(dir, 'ws'));
    const wsFile = join(home, 'workspace.json');
    const ws = JSON.parse(readFileSync(wsFile, 'utf8'));
    ws.import = { typeKeywords: { 'Startup Mission Certificate': { names: ['startup mission'], text: ['Example Startup Mission'] } } };
    ws.hierarchy = { routing: { 'Startup Mission Certificate': '01 Company/Legal and Registration' } };
    writeFileSync(wsFile, JSON.stringify(ws, null, 2));
    const vault = join(dir, 'vault');
    const LR = '01 Company/Legal and Registration';
    const files = {
      [`${LR}/company_pan.pdf`]: 'Scanned copy',
      [`${LR}/scan-0001.pdf`]: 'INCOME TAX DEPARTMENT\nPermanent Account Number\nDate: 05/03/2025',
      [`${LR}/company-profile.pdf`]: 'About the company. Founded 12th March 2024.',
      [`${LR}/Certificate of Incorporation.pdf`]: 'Permanent Account Number of the company is printed below.',
      [`${LR}/AOA.pdf`]: 'Articles of the company',
      [`${LR}/moana-notes.pdf`]: 'Notes',
      [`${LR}/registration-letter.pdf`]: 'Registered with the Example Startup Mission.\nIssued on Jan 23, 2026',
      '01 Company/Banking/cancelled check.pdf': 'Cheque',
      '02 People/Team Identity Documents/Alex Example/alex_aadhar.pdf': 'Alex Example\nDate of Birth: 01/01/1995',
      '02 People/Alex Example/Onboarding/scan.pdf': 'Offer of Internship\nDated 1st June 2026',
      '03 Clients/Events/Example Client/Proposals and Pricing/notes.pdf': 'Meeting notes',
      '03 Clients/Events/Example Client/Proposals and Pricing/summary.pdf': 'Summary ACM-REP-2026-127',
      '04 Vendors/Example Vendor/Invoices Received/order-77.pdf': 'Order 77',
      '04 Vendors/Example Vendor/Invoices Received/hosting invoice.pdf': 'Hosting',
      '05 Products/Widget App/widget-playbook.pdf': 'Plan',
      '05 Products/Widget App/Widget Deck.PDF': 'Deck',
    };
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(vault, rel, '..'), { recursive: true });
      writeFileSync(join(vault, rel), await makePdf([text]));
    }
    writeFileSync(join(vault, '05 Products/Widget App/readme.txt'), 'Plain text file (fixture)');
    // A known file time for the identity document (its only text date is a birth date).
    const known = new Date(2026, 0, 10, 12);
    utimesSync(join(vault, '02 People/Team Identity Documents/Alex Example/alex_aadhar.pdf'), known, known);
    ctx = openContext({ home, user: 'tester', env: {} });
    seedEntities(ctx);
    return await fn({ ctx, home, vault });
  } finally {
    ctx?.close();
    cleanup();
  }
}

test('type detection: name, keyword, text, series, single leaf type, else Other; identity types are Confidential', () => setupAccuracy(async ({ ctx, vault }) => {
  const s = await importFolder(ctx, { folder: vault, only: ['pdf'] });
  const got = (suffix) => {
    const d = docByPath(s, suffix);
    assert.ok(d, suffix);
    return `${d.type} <- ${d.typeFrom}`;
  };
  assert.equal(got('company_pan.pdf'), 'PAN Card <- keyword');
  assert.equal(got('scan-0001.pdf'), 'PAN Card <- text');
  assert.equal(got('company-profile.pdf'), 'Other <- none', '"company" does not name a PAN, and a multi-type leaf gives Other');
  assert.equal(got('Certificate of Incorporation.pdf'), 'Certificate of Incorporation <- name', 'the name beats the text');
  assert.equal(got('AOA.pdf'), 'Articles of Association <- keyword');
  assert.equal(got('moana-notes.pdf'), 'Other <- none');
  assert.equal(got('registration-letter.pdf'), 'Startup Mission Certificate <- text', 'workspace text phrase');
  assert.equal(got('cancelled check.pdf'), 'Cancelled Cheque <- keyword');
  assert.equal(got('alex_aadhar.pdf'), 'Aadhaar Card <- keyword');
  assert.equal(got('Onboarding/scan.pdf'), 'Internship Offer <- text');
  assert.equal(got('Proposals and Pricing/notes.pdf'), 'Other <- none', 'never the first of several leaf types');
  assert.equal(got('summary.pdf'), 'Pricing Report <- series');
  assert.equal(got('order-77.pdf'), 'Vendor Invoice <- leaf');
  assert.equal(got('hosting invoice.pdf'), 'Vendor Invoice <- name', '"Invoice" in a vendor invoice folder');
  assert.equal(got('widget-playbook.pdf'), 'Product Plan <- keyword');
  assert.equal(got('Widget Deck.PDF'), 'Other <- none');

  // Identity types are Confidential wherever they are; other company documents keep the default.
  assert.equal(docByPath(s, 'company_pan.pdf').sensitivity, 'Confidential');
  assert.equal(docByPath(s, 'scan-0001.pdf').sensitivity, 'Confidential');
  assert.equal(docByPath(s, 'AOA.pdf').sensitivity, 'Internal');
  assert.equal(docByPath(s, 'alex_aadhar.pdf').party, 'Alex Example');

  // Stored on the document: type, date and where the date came from.
  const pan = getDocument(ctx, docByPath(s, 'scan-0001.pdf').id);
  assert.equal(pan.type, 'PAN Card');
  assert.equal(pan.sensitivity, 'Confidential');
  assert.equal(pan.docDate, '2025-03-05');
  const v = ctx.db.prepare('SELECT input_json, note FROM versions WHERE document_id = ?').get(pan.id);
  assert.equal(JSON.parse(v.input_json).import.date_source, 'text-labelled');
  assert.match(v.note, /\(date from labelled text\)$/);
}));

test('dates: labelled text date, unlabelled text date, file time; never a birth date', () => setupAccuracy(async ({ ctx, vault }) => {
  const s = await importFolder(ctx, { folder: vault, only: ['pdf'], dryRun: true });
  const d = (suffix) => {
    const doc = docByPath(s, suffix);
    return `${doc.date} ${doc.dateFrom}`;
  };
  assert.equal(d('scan-0001.pdf'), '2025-03-05 text-labelled');
  assert.equal(d('company-profile.pdf'), '2024-03-12 text-first');
  assert.equal(d('registration-letter.pdf'), '2026-01-23 text-labelled');
  assert.equal(d('Onboarding/scan.pdf'), '2026-06-01 text-labelled');
  assert.equal(d('alex_aadhar.pdf'), '2026-01-10 mtime');
  assert.equal(docByPath(s, 'moana-notes.pdf').dateFrom, 'mtime');
  assert.deepEqual(s.dates, { 'text-labelled': 3, 'text-first': 1, filename: 0, mtime: 12, none: 0 });
}));

test('--only pdf skips other extensions under their own reason; without it every file is considered', () => setupAccuracy(async ({ ctx, vault }) => {
  const only = await importFolder(ctx, { folder: vault, only: ['.PDF'], dryRun: true });
  assert.deepEqual(only.skipped, [{ path: '05 Products/Widget App/readme.txt', reason: 'not in --only' }]);
  assert.equal(only.files, 17);
  assert.equal(only.imported, 16);
  assert.ok(docByPath(only, 'Widget Deck.PDF'), 'extensions compare case-insensitively');

  const all = await importFolder(ctx, { folder: vault, dryRun: true });
  assert.deepEqual(all.skipped, []);
  assert.equal(all.imported, 17);
  assert.ok(docByPath(all, 'readme.txt'));

  for (const bad of [[], ['p d f'], 'pdf', [7]]) {
    await assert.rejects(importFolder(ctx, { folder: vault, only: bad, dryRun: true }), (e) => e.code === 'INVALID_INPUT', JSON.stringify(bad));
  }
}));

test('dossier import --only pdf --dry-run --list prints each document and the date sources', () => setupAccuracy(async ({ ctx, home, vault }) => {
  ctx.close();
  const out = { text: '', write(s) { this.text += s; return true; } };
  const err = { text: '', write(s) { this.text += s; return true; } };
  const env = { DOSSIER_HOME: home, DOSSIER_USER: 'tester' };
  assert.equal(await main(['import', vault, '--only', 'pdf', '--dry-run', '--list'], { stdout: out, stderr: err, env, cwd: home }), 0, err.text);
  assert.match(out.text, /Would import\s+16/);
  assert.match(out.text, /Dates: from labelled text 3, from first date in text 1, from file name 0, from file time 12, none 0/);
  assert.match(out.text, /Documents \(type \| date \| date source \| sensitivity \| path\)/);
  assert.ok(out.text.includes('  PAN Card | 2025-03-05 | text-labelled | Confidential | 01 Company/Legal and Registration/scan-0001.pdf\n'));
  assert.ok(out.text.includes('  Aadhaar Card | 2026-01-10 | mtime | Confidential | 02 People/Team Identity Documents/Alex Example/alex_aadhar.pdf\n'));
  assert.match(out.text, /readme\.txt: not in --only/);

  // Without --list there is no per-document listing; the help names the new options.
  out.text = '';
  assert.equal(await main(['import', vault, '--dry-run'], { stdout: out, stderr: err, env, cwd: home }), 0, err.text);
  assert.doesNotMatch(out.text, /Documents \(type/);
  assert.match(out.text, /Would import\s+17/);
  out.text = '';
  assert.equal(await main(['help'], { stdout: out, stderr: err, env, cwd: home }), 0);
  assert.match(out.text, /--only <ext,\.\.\.>/);
  assert.match(out.text, /--list/);
  err.text = '';
  assert.equal(await main(['import', vault, '--only', ',', '--dry-run'], { stdout: out, stderr: err, env, cwd: home }), 1);
  assert.match(err.text, /--only needs at least one extension/);
  assert.equal(await main(['import', vault, '--only'], { stdout: out, stderr: err, env, cwd: home }), 1);
  const check = openContext({ home, user: 'tester', env: {} });
  try { assert.equal(count(check, 'documents'), 0); } finally { check.close(); }
}));


// ---------- import accuracy, fix round 1: folders limit name, keyword and text matches; file times never seed ----------

/** A fresh workspace (with a series whose pattern has no year) and a vault of the given fake PDFs. */
async function setupFiles(files, fn, { mtimes = {} } = {}) {
  const { dir, cleanup } = tmpDir('dossier-import-r1-');
  let ctx;
  try {
    const home = initWorkspace(join(dir, 'ws'));
    const seriesFile = join(home, 'series.json');
    const series = JSON.parse(readFileSync(seriesFile, 'utf8'));
    series.push({ id: 'noyear', pattern: 'ACM-X-{####}', scope: 'brand+year' });
    writeFileSync(seriesFile, JSON.stringify(series, null, 2));
    const vault = join(dir, 'vault');
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(vault, rel, '..'), { recursive: true });
      writeFileSync(join(vault, rel), await makePdf([text]));
    }
    for (const [rel, when] of Object.entries(mtimes)) utimesSync(join(vault, rel), when, when);
    ctx = openContext({ home, user: 'tester', env: {} });
    seedEntities(ctx);
    return await fn({ ctx, home, vault });
  } finally {
    ctx?.close();
    cleanup();
  }
}

const typeOf = (s, suffix) => {
  const d = docByPath(s, suffix);
  assert.ok(d, suffix);
  return `${d.type} <- ${d.typeFrom}`;
};

test('a file-time date never seeds a counter, and the warning says so (C-1)', () => setupFiles({
  '01 Company/Board and Governance/ACM-X-0042.pdf': 'Resolution without a written date',
  '01 Company/Board and Governance/ACM-X-0050.pdf': 'Resolution\nDate: 05/03/2025',
}, async ({ ctx, vault }) => {
  const s = await importFolder(ctx, { folder: vault });
  assert.equal(docByPath(s, 'ACM-X-0042.pdf').dateFrom, 'mtime');
  assert.equal(docByPath(s, 'ACM-X-0042.pdf').date, '2023-06-15');
  const keys = ctx.db.prepare('SELECT scope_key, next FROM sequences ORDER BY scope_key').all();
  assert.ok(!keys.some((k) => k.scope_key.includes('2023')), `no 2023 counter: ${JSON.stringify(keys)}`);
  // The labelled text date seeds its year's counter past its number.
  assert.ok(keys.some((k) => k.scope_key.includes('2025') && k.next === 51), JSON.stringify(keys));
  const w = s.warnings.find((x) => x.path.endsWith('ACM-X-0042.pdf'));
  assert.ok(w, 'the unseeded counter is reported');
  assert.match(w.message, /^counter not seeded for ACM-X-0042 \(its only date is the file time, which does not set a counter year\): /);
  assert.ok(!s.warnings.some((x) => x.path.endsWith('ACM-X-0050.pdf')));
  // The stored document keeps the file-time date, marked as such.
  const doc = getDocument(ctx, docByPath(s, 'ACM-X-0042.pdf').id);
  assert.equal(doc.docDate, '2023-06-15');
  const v = ctx.db.prepare('SELECT input_json, note FROM versions WHERE document_id = ?').get(doc.id);
  assert.equal(JSON.parse(v.input_json).import.date_source, 'mtime');
  assert.match(v.note, /\(date from file time\)$/);
}, { mtimes: { '01 Company/Board and Governance/ACM-X-0042.pdf': new Date(2023, 5, 15, 12) } }));

test('text phrases do not override a folder whose types they do not fit (I-1)', () => setupFiles({
  '03 Clients/Events/Example Client/Invoices and Receipts/bill-01.pdf': 'Example Org\nPermanent Account Number printed on the bill',
  '01 Company/Banking and Payments/letter-02.pdf': 'Permanent Account Number of the holder',
  '01 Company/Board and Governance/resolution-07.pdf': 'Resolved, under the Articles of Association, that ...',
  '03 Clients/Events/Example Client/Proposals and Pricing/notes-03.pdf': 'Thank you for the call. Our proposal for the event follows.',
  '03 Clients/Events/Example Client/Proposals and Pricing/offer-04.pdf': 'Service Proposal\nSee our brochure for the product.',
  '03 Clients/Events/Example Client/Agreements/draft-05.pdf': 'This Memorandum of Understanding is an agreement between ...',
  '04 Vendors/Example Vendor/Invoices Received/bill-06.pdf': 'TAX INVOICE\nExample Vendor',
  '01 Company/Legal and Registration/scan-08.pdf': 'Permanent Account Number',
  '01 Company/scan-09.pdf': 'Permanent Account Number (company copy)',
  '03 Clients/Events/Example Client/scan-10.pdf': 'Permanent Account Number (client copy)',
}, async ({ ctx, vault }) => {
  const s = await importFolder(ctx, { folder: vault, dryRun: true });
  assert.equal(typeOf(s, 'bill-01.pdf'), 'Other <- none', 'PAN phrase in an invoice folder');
  assert.equal(docByPath(s, 'bill-01.pdf').sensitivity, 'Internal');
  assert.equal(typeOf(s, 'letter-02.pdf'), 'Other <- none', 'PAN phrase in a bank folder');
  assert.equal(typeOf(s, 'resolution-07.pdf'), 'Board Resolution <- leaf', 'AoA cited by a resolution');
  assert.equal(typeOf(s, 'notes-03.pdf'), 'Other <- none', '"proposal for" is not a type phrase');
  assert.equal(typeOf(s, 'offer-04.pdf'), 'Proposal <- text', '"brochure" is not a type phrase; the heading fits the leaf');
  assert.equal(typeOf(s, 'draft-05.pdf'), 'Other <- none', '"Memorandum of Understanding" is not a type phrase');
  assert.equal(typeOf(s, 'bill-06.pdf'), 'Vendor Invoice <- leaf', '"Tax Invoice" is not a type phrase');
  // Identity phrases still count in a legal leaf and in a type-less company folder, not in a client folder.
  assert.equal(typeOf(s, 'scan-08.pdf'), 'PAN Card <- text');
  assert.equal(typeOf(s, 'scan-09.pdf'), 'PAN Card <- text');
  assert.equal(typeOf(s, 'scan-10.pdf'), 'Other <- none');
}));

test('generic words in file names do not override folders (I-2)', () => setupFiles({
  '05 Products/Widget App/Pan India rollout plan.pdf': 'Plan',
  '01 Company/Compliance and Tax/GST return Q1.pdf': 'Return',
  '01 Company/Compliance and Tax/gst-2025-03.pdf': 'Monthly return',
  '01 Company/Legal and Registration/acme_gst.pdf': 'Certificate',
  '01 Company/Legal and Registration/Example Org GST Registration.pdf': 'Registration certificate',
  '01 Company/recognition award.pdf': 'Award',
  '01 Company/Legal and Registration/recognition certificate.pdf': 'Recognition',
  '05 Products/Widget App/epic campaign.pdf': 'Campaign',
  '02 People/Casey Example/epic card.pdf': 'Card',
  '02 People/Casey Example/Exit/Reference letter.pdf': 'To whom it may concern',
  '02 People/Casey Example/Exit/settlement - Casey.pdf': 'Amounts',
  '02 People/Casey Example/Exit/template-notes.pdf': 'Notes',
  '02 People/Casey Example/Exit/gst certificate copy.pdf': 'Copy kept with the exit papers',
}, async ({ ctx, vault }) => {
  const s = await importFolder(ctx, { folder: vault, dryRun: true });
  assert.equal(typeOf(s, 'Pan India rollout plan.pdf'), 'Other <- none');
  assert.equal(typeOf(s, 'GST return Q1.pdf'), 'Other <- none');
  assert.equal(typeOf(s, 'gst-2025-03.pdf'), 'Other <- none');
  assert.equal(typeOf(s, 'acme_gst.pdf'), 'GST Certificate <- keyword');
  assert.equal(typeOf(s, 'Example Org GST Registration.pdf'), 'GST Certificate <- keyword');
  assert.equal(typeOf(s, 'recognition award.pdf'), 'Other <- none');
  assert.equal(typeOf(s, 'recognition certificate.pdf'), 'Startup Recognition Certificate <- keyword');
  assert.equal(typeOf(s, 'epic campaign.pdf'), 'Other <- none');
  assert.equal(typeOf(s, 'epic card.pdf'), 'Voter ID <- keyword');
  assert.equal(typeOf(s, 'Reference letter.pdf'), 'Other <- none', 'Reference only in the References folder');
  assert.equal(typeOf(s, 'template-notes.pdf'), 'Other <- none', 'Template only in the Templates folder');
  assert.equal(typeOf(s, 'settlement - Casey.pdf'), 'Final Settlement <- keyword', 'the Exit leaf type that contains the word');
  assert.equal(typeOf(s, 'gst certificate copy.pdf'), 'Other <- none', 'a company type in a person\'s leaf folder');
}));
