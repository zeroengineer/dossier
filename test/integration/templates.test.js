import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { minimalBrand, writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { getTemplate, listTemplateErrors, listTemplates } from '../../src/services/templates.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'templates');
const FIXTURE_JSON = readFileSync(join(FIXTURES, 'sample-letter', 'template.json'), 'utf8');

async function withCtx(fn, spec = {}, env = {}) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    writeWorkspace(dir, { brands: { acme: minimalBrand('acme') }, series: [{ id: 'generic', pattern: 'GEN-{####}' }], ...spec });
    ctx = openContext({ home: dir, user: 'tester', dbFile: ':memory:', env });
    return await fn(ctx, dir);
  } finally {
    ctx?.close();
    cleanup();
  }
}

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const rows = (ctx) => ctx.db.prepare('SELECT id, version, source, path, hash, meta_json FROM templates ORDER BY id').all();

test('listTemplates registers extra template dirs and upserts registry rows with a content hash', () => withCtx((ctx) => {
  const list = listTemplates(ctx, { dirs: [FIXTURES] });
  const t = list.find((x) => x.id === 'sample-letter');
  assert.ok(t);
  assert.equal(t.source, 'builtin');
  assert.equal(t.version, 1);
  assert.equal(t.category, 'letter');
  assert.match(t.hash, /^[0-9a-f]{64}$/);
  const [row] = rows(ctx).filter((r) => r.id === 'sample-letter');
  assert.equal(row.hash, t.hash);
  assert.equal(JSON.parse(row.meta_json).title, 'Sample letter');
  const audits = ctx.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'template.%' AND target_id = 'sample-letter@1'").all();
  assert.deepEqual(audits.map((a) => a.action), ['template.register']);
  const auditCount = () => ctx.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action LIKE 'template.%'").get().n;
  const n = auditCount();

  listTemplates(ctx, { dirs: [FIXTURES] });
  assert.equal(auditCount(), n, 'unchanged templates are not rewritten');
}));

test('without extra dirs the fixture is not listed (built-ins stay clean)', () => withCtx((ctx) => {
  assert.equal(listTemplates(ctx).some((t) => t.id === 'sample-letter'), false);
}));

test('DOSSIER_TEMPLATE_DIRS (config.templateDirs) adds template folders', () => withCtx((ctx) => {
  assert.deepEqual(ctx.config.templateDirs, [FIXTURES]);
  assert.ok(listTemplates(ctx).some((t) => t.id === 'sample-letter'));
}, {}, { DOSSIER_TEMPLATE_DIRS: FIXTURES }));

test('a workspace template with the same id overrides the built-in one; its hash covers index.js and body.md', () => withCtx(async (ctx, home) => {
  const before = listTemplates(ctx, { dirs: [FIXTURES] }).find((t) => t.id === 'sample-letter');
  const wsDir = join(home, 'templates', 'sample-letter');
  cpSync(join(FIXTURES, 'sample-letter'), wsDir, { recursive: true });
  writeFileSync(join(wsDir, 'template.json'), FIXTURE_JSON.replace('"Sample letter"', '"Workspace letter"'));

  const t = listTemplates(ctx, { dirs: [FIXTURES] }).find((x) => x.id === 'sample-letter');
  assert.equal(t.source, 'workspace');
  assert.equal(t.title, 'Workspace letter');
  assert.equal(t.path, wsDir);
  assert.notEqual(t.hash, before.hash);
  const [row] = rows(ctx).filter((r) => r.id === 'sample-letter');
  assert.equal(row.source, 'workspace');
  assert.equal(row.hash, t.hash);

  writeFileSync(join(wsDir, 'index.js'), `${readFileSync(join(wsDir, 'index.js'), 'utf8')}\nexport const marker = 'changed';\n`);
  const t2 = listTemplates(ctx, { dirs: [FIXTURES] }).find((x) => x.id === 'sample-letter');
  assert.notEqual(t2.hash, t.hash, 'index.js bytes are part of the hash');
  writeFileSync(join(wsDir, 'body.md'), '# Body\n');
  const t3 = listTemplates(ctx, { dirs: [FIXTURES] }).find((x) => x.id === 'sample-letter');
  assert.notEqual(t3.hash, t2.hash, 'body.md bytes are part of the hash');

  const loaded = await getTemplate(ctx, 'sample-letter', { dirs: [FIXTURES] });
  assert.equal(loaded.source, 'workspace');
  assert.equal(loaded.module.marker, 'changed', 'the changed module is re-imported');
  assert.equal(loaded.body, '# Body\n');
  assert.equal(loaded.hash, t3.hash);
  assert.equal(typeof loaded.module.blocks, 'function');
}));

test('getTemplate loads meta and module; unknown ids throw TEMPLATE_NOT_FOUND', () => withCtx(async (ctx) => {
  const t = await getTemplate(ctx, 'sample-letter', { dirs: [FIXTURES] });
  assert.equal(t.meta.contact, 'hr');
  assert.equal(typeof t.module.computed.annual, 'function');
  assert.equal(t.body, undefined);
  await assert.rejects(getTemplate(ctx, 'nope', { dirs: [FIXTURES] }), code('TEMPLATE_NOT_FOUND'));
}));

test('a template with only body.md loads with an empty module', () => withCtx(async (ctx) => {
  const t = await getTemplate(ctx, 'notes');
  assert.deepEqual({ ...t.module }, {});
  assert.equal(t.body, 'Hello {{name}}\n');
}, {
  files: {
    'templates/notes/template.json': JSON.stringify({
      id: 'notes', version: 1, type: 'Note', title: 'Note', category: 'letter', layoutProfile: 'letter',
      partyType: 'Company', partyKind: 'company', sensitivity: 'Internal', fields: [{ name: 'name', source: 'ask' }],
    }),
    'templates/notes/body.md': 'Hello {{name}}\n',
  },
}));

test('an invalid template folder is reported, left out of the list, and only breaks its own id', async (t) => {
  const meta = JSON.parse(FIXTURE_JSON);
  const notes = JSON.stringify({ ...meta, id: 'notes', numbering: null, relations: [], fields: [{ name: 'name', source: 'ask' }] });
  const good = { 'templates/notes/template.json': notes, 'templates/notes/body.md': 'Hi {{name}}\n' };
  const cases = {
    'bad JSON': ['{oops', /invalid JSON/],
    'schema error': [JSON.stringify({ ...meta, category: 'memo' }), /templates\/sample-letter\/template\.json: invalid:\n {2}category/],
    'id mismatch': [JSON.stringify({ ...meta, id: 'other' }), /must match the folder name "sample-letter"/],
    'unknown series': [JSON.stringify({ ...meta, numbering: { series: 'missing' } }), /unknown series "missing"/],
  };
  for (const [name, [json, re]] of Object.entries(cases)) {
    await t.test(name, () => withCtx(async (ctx) => {
      const list = listTemplates(ctx, { dirs: [FIXTURES] });
      assert.deepEqual(list.map((x) => x.id).filter((id) => id !== 'test-note'), ['notes'], 'the broken override is left out, the fixture is not used in its place');
      const errors = listTemplateErrors(ctx, { dirs: [FIXTURES] });
      assert.equal(errors.length, 1);
      assert.equal(errors[0].id, 'sample-letter');
      assert.equal(errors[0].source, 'workspace');
      assert.equal(errors[0].code, 'TEMPLATE_INVALID');
      assert.match(errors[0].message, re);
      await assert.rejects(getTemplate(ctx, 'sample-letter', { dirs: [FIXTURES] }), (err) => code('TEMPLATE_INVALID')(err) && re.test(err.message));
      assert.equal((await getTemplate(ctx, 'notes', { dirs: [FIXTURES] })).body, 'Hi {{name}}\n', 'other templates still load');
    }, { files: { ...good, 'templates/sample-letter/template.json': json, 'templates/sample-letter/index.js': 'export {};\n' } }));
  }
  await t.test('no index.js and no body.md', () => withCtx(async (ctx) => {
    assert.match(listTemplateErrors(ctx)[0].message, /needs index\.js or body\.md/);
    await assert.rejects(getTemplate(ctx, 'sample-letter'), /needs index\.js or body\.md/);
  }, { files: { 'templates/sample-letter/template.json': FIXTURE_JSON } }));
  await t.test('computed field without an exported function', () => withCtx(async (ctx) => {
    await assert.rejects(getTemplate(ctx, 'sample-letter'), (err) => code('TEMPLATE_INVALID')(err) && /computed\.annual/.test(err.message));
  }, { files: { 'templates/sample-letter/template.json': FIXTURE_JSON, 'templates/sample-letter/index.js': 'export const computed = {};\n' } }));
});

test('every .js file in the template folder is part of the hash', () => withCtx((ctx, home) => {
  const files = {
    'template.json': FIXTURE_JSON,
    'index.js': readFileSync(join(FIXTURES, 'sample-letter', 'index.js'), 'utf8'),
    'lib/helpers.js': 'export const x = 1;\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(home, 'templates', 'sample-letter', rel, '..'), { recursive: true });
    writeFileSync(join(home, 'templates', 'sample-letter', rel), body);
  }
  const before = listTemplates(ctx)[0].hash;
  writeFileSync(join(home, 'templates', 'sample-letter', 'lib', 'helpers.js'), 'export const x = 2;\n');
  assert.notEqual(listTemplates(ctx)[0].hash, before);
  writeFileSync(join(home, 'templates', 'sample-letter', 'notes.txt'), 'not code');
  const h = listTemplates(ctx)[0].hash;
  writeFileSync(join(home, 'templates', 'sample-letter', 'notes.txt'), 'still not code');
  assert.equal(listTemplates(ctx)[0].hash, h, 'other files do not count');
}));
