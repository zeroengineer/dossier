import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { tmpDir } from '../helpers/tmp.js';
import { extractItems } from '../helpers/pdfText.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { upsertEntity } from '../../src/services/entities.js';
import { createDocument, getDocument, readRendition, updateStatus } from '../../src/services/documents.js';
import { allocateNumber } from '../../src/services/numbering.js';
import { search } from '../../src/services/search.js';
import { canonicalJson, generateDocument, previewDocument, previewToken } from '../../src/services/generator.js';

sharp.cache(false);
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'templates');

async function withCtx(fn, { clearance, file = false } = {}) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    const home = join(dir, 'ws');
    initWorkspace(home);
    const brandFile = join(home, 'brands', 'acme', 'brand.json');
    const brand = JSON.parse(readFileSync(brandFile, 'utf8'));
    brand.series['test-note'] = 'generic';
    writeFileSync(brandFile, JSON.stringify(brand, null, 2));
    if (clearance) {
      const wsFile = join(home, 'workspace.json');
      const ws = JSON.parse(readFileSync(wsFile, 'utf8'));
      ws.users = { ...ws.users, tester: { clearance } };
      writeFileSync(wsFile, JSON.stringify(ws, null, 2));
    }
    ctx = openContext({ home, user: 'tester', ...(file ? {} : { dbFile: ':memory:' }), env: {} });
    ctx.templateDirs = [FIXTURES];
    ctx.person = upsertEntity(ctx, { kind: 'person', name: 'Jordan Example' });
    ctx.signer = upsertEntity(ctx, { kind: 'person', name: 'Sam Sample' });
    ctx.company = upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited', brand: 'acme' });
    return await fn(ctx, home);
  } finally {
    ctx?.close();
    cleanup();
  }
}

const INPUT = { person: 'Jordan Example', subject: 'Quarterly review', body: 'The review meeting moves to the second week.', date: '2026-06-01' };
const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const count = (ctx, sql, ...args) => ctx.db.prepare(sql).get(...args).n;
const pdfText = async (buf) => (await extractItems(buf)).map((i) => i.text).join(' ');

test('preview renders every rendition with DRAFT, a watermark on each page, and touches no document state', () => withCtx(async (ctx, home) => {
  const before = {
    docs: count(ctx, 'SELECT COUNT(*) AS n FROM documents'),
    seqs: count(ctx, "SELECT COUNT(*) AS n FROM sequences WHERE scope_key LIKE 'num:%'"),
    audits: count(ctx, "SELECT COUNT(*) AS n FROM audit_log WHERE target_kind IN ('document', 'blob', 'sequence')"),
  };
  const r = await previewDocument(ctx, 'test-note', INPUT);
  assert.equal(r.ok, true);
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.equal(r.token, await previewToken(ctx, 'test-note', INPUT));
  assert.deepEqual(r.renditions.map((x) => x.kind), ['pdf', 'html', 'md']);
  for (const x of r.renditions) {
    assert.ok(x.path.startsWith(join(home, 'data', 'previews', r.token)), x.path);
    assert.equal(readFileSync(x.path).length, x.bytes);
  }
  const pdf = readFileSync(r.renditions[0].path);
  const items = await extractItems(pdf);
  const text = items.map((i) => i.text).join(' ');
  assert.match(text, /DRAFT/);
  assert.doesNotMatch(text, /ACM-DOC/);
  const pages = new Set(items.map((i) => i.page));
  for (const p of pages) {
    assert.ok(items.some((i) => i.page === p && i.text.includes('DRAFT — NOT NUMBERED')), `watermark on page ${p}`);
  }
  assert.match(readFileSync(r.renditions[1].path, 'utf8'), /DRAFT/);
  assert.match(readFileSync(r.renditions[2].path, 'utf8'), /DRAFT/);
  assert.deepEqual({
    docs: count(ctx, 'SELECT COUNT(*) AS n FROM documents'),
    seqs: count(ctx, "SELECT COUNT(*) AS n FROM sequences WHERE scope_key LIKE 'num:%'"),
    audits: count(ctx, "SELECT COUNT(*) AS n FROM audit_log WHERE target_kind IN ('document', 'blob', 'sequence')"),
  }, before, 'no document, number, blob or audit rows');

  const again = await previewDocument(ctx, 'test-note', { ...INPUT });
  assert.equal(again.token, r.token, 'same input -> same token');
  const other = await previewDocument(ctx, 'test-note', { ...INPUT, subject: 'Other' });
  assert.notEqual(other.token, r.token);
}));

test('preview and generate report missing and invalid fields', () => withCtx(async (ctx) => {
  const r = await previewDocument(ctx, 'test-note', { person: 'Jordan Example' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.name), ['subject', 'body']);
  await assert.rejects(generateDocument(ctx, 'test-note', { person: 'Jordan Example' }), (err) => {
    assert.equal(err.code, 'FIELDS_MISSING');
    assert.deepEqual(err.details.missing.map((m) => m.name), ['subject', 'body']);
    assert.match(err.message, /subject, body/);
    return true;
  });
  await assert.rejects(generateDocument(ctx, 'test-note', { ...INPUT, total: 'lots' }), code('FIELDS_INVALID'));
  assert.equal(count(ctx, 'SELECT COUNT(*) AS n FROM documents'), 0);
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM sequences WHERE scope_key LIKE 'num:%'"), 0, 'nothing allocated');
}));

test('generate allocates consecutive numbers and stores three renditions with metadata, links and audit', () => withCtx(async (ctx) => {
  const prior = createDocument(ctx, { type: 'Note', title: 'Earlier note' });
  const a = await generateDocument(ctx, 'test-note', { ...INPUT, total: '1,500', basedOn: prior.id });
  const b = await generateDocument(ctx, 'test-note', { ...INPUT, subject: 'Second note' });
  assert.equal(a.number, 'ACM-DOC-2026-0001');
  assert.equal(b.number, 'ACM-DOC-2026-0002');
  assert.equal(a.versionNo, 1);
  assert.deepEqual(a.renditions.map((r) => r.kind), ['pdf', 'html', 'md']);
  for (const r of a.renditions) {
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.ok(r.bytes > 0);
    assert.match(r.filename, /^2026-06-01_JordanExample_Note_ACM-DOC-2026-0001_v1\.(pdf|html|md)$/);
  }

  const doc = getDocument(ctx, a.documentId);
  assert.equal(doc.docNumber, 'ACM-DOC-2026-0001');
  assert.equal(doc.numberSeries, 'generic');
  assert.equal(doc.status, 'Draft');
  assert.equal(doc.party.id, ctx.person.id);
  assert.equal(doc.party.type, 'Person');
  assert.equal(doc.docDate, '2026-06-01');
  assert.equal(doc.amountMinor, 150000);
  assert.equal(doc.currency, 'INR');
  assert.equal(doc.sensitivity, 'Internal');
  assert.equal(doc.issuingBrandId, 'acme');
  assert.equal(doc.issuingEntity.id, ctx.company.id);
  assert.deepEqual(doc.template, { id: 'test-note', version: 1 });

  const pdf = readRendition(ctx, a.documentId, { kind: 'pdf' });
  const text = await pdfText(pdf.buffer);
  assert.match(text, /ACM-DOC-2026-0001/);
  assert.doesNotMatch(text, /NOT NUMBERED/);

  const roles = ctx.db.prepare('SELECT entity_id, role FROM document_entities WHERE document_id = ? ORDER BY role').all(a.documentId);
  assert.deepEqual(roles.map((r) => ({ ...r })), [
    { entity_id: ctx.company.id, role: 'issuer' },
    { entity_id: ctx.person.id, role: 'party' },
    { entity_id: ctx.signer.id, role: 'signatory' },
  ]);
  const rels = ctx.db.prepare('SELECT to_doc, type, attrs FROM document_relations WHERE from_doc = ? ORDER BY type').all(a.documentId);
  assert.deepEqual(rels.map((r) => [r.type, r.to_doc]), [['based_on', prior.id], ['generated_from', 'template:test-note@1']]);
  const gen = JSON.parse(rels[1].attrs);
  assert.equal(gen.templateId, 'test-note');
  assert.equal(gen.templateVersion, 1);
  assert.match(gen.templateHash, /^[0-9a-f]{64}$/);

  const version = ctx.db.prepare('SELECT input_json FROM versions WHERE document_id = ?').get(a.documentId);
  assert.equal(version.input_json, JSON.stringify(Object.fromEntries(Object.entries({ ...INPUT, total: '1,500', basedOn: prior.id }).sort())));

  const actions = ctx.db.prepare('SELECT action FROM audit_log WHERE target_id = ? ORDER BY id').all(a.documentId).map((r) => r.action);
  for (const act of ['document.create', 'document.version.add', 'document.link', 'document.generate']) assert.ok(actions.includes(act), `${act} audited`);

  const found = search(ctx, { q: 'Quarterly review' });
  assert.ok(found.hits.some((h) => h.document.id === a.documentId), 'search finds the generated document by its text');
  assert.equal(search(ctx, { q: 'ACM-DOC-2026-0002' }).hits[0].document.id, b.documentId);
}));

test('identical renditions are stored once; regenerate keeps the number and adds version 2', () => withCtx(async (ctx) => {
  const a = await generateDocument(ctx, 'test-note', INPUT);
  const blobsBefore = count(ctx, 'SELECT COUNT(*) AS n FROM blobs');
  const same = await generateDocument(ctx, 'test-note', INPUT, { documentId: a.documentId });
  assert.equal(same.versionNo, 2);
  assert.equal(same.number, a.number);
  const sha = (r, kind) => r.renditions.find((x) => x.kind === kind).sha256;
  assert.equal(sha(same, 'html'), sha(a, 'html'));
  assert.equal(sha(same, 'md'), sha(a, 'md'));
  // The PDF embeds its creation time (now), so only it may be a new blob; html and md are stored once.
  assert.ok(count(ctx, 'SELECT COUNT(*) AS n FROM blobs') - blobsBefore <= 1, 'html and md deduped');
  assert.equal(count(ctx, 'SELECT COUNT(DISTINCT blob_sha256) AS n FROM renditions WHERE kind IN (\'html\', \'md\')'), 2);

  const r = await generateDocument(ctx, 'test-note', { ...INPUT, subject: 'Revised subject' }, { documentId: a.documentId, status: 'Draft' });
  assert.equal(r.documentId, a.documentId);
  assert.equal(r.number, a.number);
  assert.equal(r.versionNo, 3);
  const doc = getDocument(ctx, a.documentId);
  assert.equal(doc.status, 'Draft');
  assert.equal(doc.versions.length, 3);
  assert.equal(doc.currentVersion, 3);
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM sequences WHERE scope_key LIKE 'num:%' AND next = 2"), 1, 'no new number taken');

  const again = await generateDocument(ctx, 'test-note', { ...INPUT, subject: 'Third' }, { documentId: a.documentId });
  assert.equal(again.versionNo, 4);
  assert.equal(getDocument(ctx, a.documentId).status, 'Draft');
  const md = readRendition(ctx, a.documentId, { kind: 'md' });
  assert.match(md.buffer.toString('utf8'), /Third/);
  await assert.rejects(generateDocument(ctx, 'sample-letter', INPUT, { documentId: a.documentId }), code('INVALID_INPUT'));
}));

test('concurrent generations get distinct numbers and every PDF shows its own number', () => withCtx(async (ctx) => {
  const results = await Promise.all([1, 2, 3].map((i) => generateDocument(ctx, 'test-note', { ...INPUT, subject: `Parallel ${i}` })));
  assert.deepEqual(results.map((r) => r.number).sort(), ['ACM-DOC-2026-0001', 'ACM-DOC-2026-0002', 'ACM-DOC-2026-0003']);
  for (const r of results) {
    const text = await pdfText(readRendition(ctx, r.documentId, { kind: 'pdf' }).buffer);
    assert.match(text, new RegExp(r.number));
    assert.equal(getDocument(ctx, r.documentId).docNumber, r.number);
  }
  assert.equal(count(ctx, 'SELECT COUNT(*) AS n FROM documents'), 3, 'no numbered document without a version');
  assert.equal(count(ctx, 'SELECT COUNT(*) AS n FROM documents WHERE current_version_id IS NULL'), 0);
}));

test('a template above the user clearance cannot be previewed or generated', () => withCtx(async (ctx) => {
  await assert.rejects(previewDocument(ctx, 'sample-letter', {}), code('FORBIDDEN'));
  await assert.rejects(generateDocument(ctx, 'sample-letter', {}), code('FORBIDDEN'));
}, { clearance: 'Internal' }));

test('regenerating a Sent, Signed or Paid document is refused unless forced; forced resets are audited', () => withCtx(async (ctx) => {
  const a = await generateDocument(ctx, 'test-note', INPUT);
  await assert.rejects(generateDocument(ctx, 'test-note', INPUT, { documentId: a.documentId, status: 'Sent' }), code('INVALID_INPUT'),
    'a Draft regenerates as Draft only');
  await assert.rejects(generateDocument(ctx, 'test-note', INPUT, { status: 'Bogus' }), code('INVALID_INPUT'));
  await assert.rejects(generateDocument(ctx, 'test-note', INPUT, { status: 'Superseded' }), code('INVALID_INPUT'));
  updateStatus(ctx, a.documentId, 'Sent');
  updateStatus(ctx, a.documentId, 'Paid');

  await assert.rejects(generateDocument(ctx, 'test-note', { ...INPUT, subject: 'Changed' }, { documentId: a.documentId }), (err) => {
    assert.equal(err.code, 'STATUS_LOCKED');
    assert.match(err.details.hint, /supersede/);
    return true;
  });
  assert.equal(getDocument(ctx, a.documentId).versions.length, 1, 'nothing written');
  await assert.rejects(generateDocument(ctx, 'test-note', INPUT, { documentId: a.documentId, force: true, status: 'Sent' }), code('INVALID_INPUT'),
    'with force only Draft or the current status');

  const kept = await generateDocument(ctx, 'test-note', { ...INPUT, subject: 'Kept paid' }, { documentId: a.documentId, force: true, status: 'Paid' });
  assert.equal(kept.versionNo, 2);
  assert.equal(getDocument(ctx, a.documentId).status, 'Paid');

  const forced = await generateDocument(ctx, 'test-note', { ...INPUT, subject: 'Forced' }, { documentId: a.documentId, force: true });
  assert.equal(forced.versionNo, 3);
  assert.equal(forced.number, a.number);
  assert.equal(getDocument(ctx, a.documentId).status, 'Draft');
  const reset = ctx.db.prepare("SELECT before, after FROM audit_log WHERE action = 'document.status' AND target_id = ? ORDER BY id DESC LIMIT 1").get(a.documentId);
  assert.deepEqual(JSON.parse(reset.before), { status: 'Paid' });
  assert.deepEqual(JSON.parse(reset.after), { status: 'Draft', reason: 'regenerate', force: true, versionNo: 3 });
}));

test('another brand on regeneration and bad relation targets are refused before anything is written', () => withCtx(async (ctx) => {
  const a = await generateDocument(ctx, 'test-note', INPUT);
  await assert.rejects(generateDocument(ctx, 'test-note', INPUT, { documentId: a.documentId, brandId: 'other' }), code('INVALID_INPUT'));
  await assert.rejects(generateDocument(ctx, 'test-note', { ...INPUT, basedOn: 'DOC-999999' }), code('DOCUMENT_NOT_FOUND'));
  await assert.rejects(generateDocument(ctx, 'test-note', { ...INPUT, basedOn: 'nonsense' }), code('INVALID_INPUT'));
  await assert.rejects(generateDocument(ctx, 'test-note', { ...INPUT, basedOn: a.documentId }, { documentId: a.documentId }), code('INVALID_INPUT'));
  assert.equal(count(ctx, 'SELECT COUNT(*) AS n FROM documents'), 1);
  assert.equal(count(ctx, "SELECT next AS n FROM sequences WHERE scope_key LIKE 'num:%'"), 2, 'no number taken by refused generations');
}));

test('final renditions of an unnumbered template never print DRAFT; its preview does', () => withCtx(async (ctx) => {
  const input = { person: 'Jordan Example', text: 'Plain memo body.', date: '2026-06-01' };
  const g = await generateDocument(ctx, 'test-memo', input);
  assert.equal(g.number, null);
  const pdf = await pdfText(readRendition(ctx, g.documentId, { kind: 'pdf' }).buffer);
  const md = readRendition(ctx, g.documentId, { kind: 'md' }).buffer.toString('utf8');
  assert.match(pdf, /Plain memo body/);
  assert.doesNotMatch(pdf, /DRAFT/);
  assert.doesNotMatch(md, /DRAFT|Reference/);
  const p = await previewDocument(ctx, 'test-memo', input);
  assert.match(readFileSync(p.renditions.find((r) => r.kind === 'md').path, 'utf8'), /Reference DRAFT/);
  assert.equal(getDocument(ctx, g.documentId).docNumber, null);
}));

test('five parallel generations in one process are queued per series and all succeed', () => withCtx(async (ctx) => {
  let renders = 0;
  globalThis.__dossierRenderHook = () => { renders++; };
  try {
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => generateDocument(ctx, 'test-note', { ...INPUT, subject: `Queued ${i}` })));
    assert.deepEqual(results.map((r) => r.number), [1, 2, 3, 4, 5].map((i) => `ACM-DOC-2026-000${i}`), 'numbers in call order');
    assert.equal(renders, 5, 'each generation rendered once: no retries in one process');
  } finally {
    delete globalThis.__dossierRenderHook;
  }
}));

test('another connection taking the peeked number forces a re-render; rolled-back allocations consume nothing', () => withCtx(async (ctx, home) => {
  const other = openContext({ home, user: 'tester', env: {} });
  const takeOne = () => allocateNumber(other, 'generic', { date: '2026-06-01' }).number;
  const next = () => count(ctx, "SELECT next AS n FROM sequences WHERE scope_key LIKE 'num:%'");
  try {
    let left = 1;
    globalThis.__dossierRenderHook = (values, env) => { if (!env.draft && left-- > 0) takeOne(); };
    const r = await generateDocument(ctx, 'test-note', INPUT);
    assert.equal(r.number, 'ACM-DOC-2026-0002', 'the other connection took 0001 during the first render');
    assert.match(await pdfText(readRendition(ctx, r.documentId, { kind: 'pdf' }).buffer), /ACM-DOC-2026-0002/);
    assert.equal(next(), 3, 'one number each: the mismatched allocation was rolled back');

    globalThis.__dossierRenderHook = (values, env) => { if (!env.draft) takeOne(); };
    await assert.rejects(generateDocument(ctx, 'test-note', { ...INPUT, subject: 'Contended' }), (err) => {
      assert.equal(err.code, 'NUMBER_CONTENDED');
      assert.equal(err.details.attempts, 3);
      return true;
    });
    assert.equal(next(), 6, 'only the three numbers the other connection took were consumed');
    assert.equal(count(ctx, 'SELECT COUNT(*) AS n FROM documents'), 1, 'no document for the failed generation');
  } finally {
    delete globalThis.__dossierRenderHook;
    other.close();
  }
}, { file: true }));

test('canonicalJson sorts keys and rejects values JSON cannot carry', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, { d: 'x', c: undefined }] }), '{"a":[true,null,{"d":"x"}],"b":1}');
  for (const bad of [{ n: 10n }, { f: () => 1 }, { x: Number.NaN }, { m: new Map() }, { s: Symbol('s') }]) {
    assert.throws(() => canonicalJson(bad), code('INVALID_INPUT'));
  }
});

test('generate rejects BigInt input with INVALID_INPUT before anything is written', () => withCtx(async (ctx) => {
  await assert.rejects(generateDocument(ctx, 'test-note', { ...INPUT, total: 5n }), code('INVALID_INPUT'));
  assert.equal(count(ctx, 'SELECT COUNT(*) AS n FROM documents'), 0);
}));
