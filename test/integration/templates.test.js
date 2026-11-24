import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { minimalBrand, writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { BUILTIN_TEMPLATES_DIR, getTemplate, listTemplateErrors, listTemplates } from '../../src/services/templates.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'templates');
/** Shipped built-in template ids (left out where a test lists only its own templates). */
const BUILTINS = readdirSync(BUILTIN_TEMPLATES_DIR).filter((n) => existsSync(join(BUILTIN_TEMPLATES_DIR, n, 'template.json')));
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
      assert.deepEqual(list.map((x) => x.id).filter((id) => !id.startsWith('test-') && !BUILTINS.includes(id)), ['notes'], 'the broken override is left out, the fixture is not used in its place');
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

const sampleHash = (ctx) => listTemplates(ctx).find((t) => t.id === 'sample-letter').hash;

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
  const before = sampleHash(ctx);
  writeFileSync(join(home, 'templates', 'sample-letter', 'lib', 'helpers.js'), 'export const x = 2;\n');
  assert.notEqual(sampleHash(ctx), before);
  writeFileSync(join(home, 'templates', 'sample-letter', 'notes.txt'), 'not code');
  const h = sampleHash(ctx);
  writeFileSync(join(home, 'templates', 'sample-letter', 'notes.txt'), 'still not code');
  assert.equal(sampleHash(ctx), h, 'other files do not count');
}));

// ---------- workspace overrides without index.js inherit the built-in module ----------

/** Copy the fixture templates to a temporary "built-in" folder that the test may edit. */
function withBase(fn) {
  return withCtx(async (ctx, home) => {
    const base = join(home, 'builtin-copy');
    cpSync(FIXTURES, base, { recursive: true });
    return fn(ctx, home, base);
  });
}
const put = (home, rel, body) => {
  mkdirSync(join(home, rel, '..'), { recursive: true });
  writeFileSync(join(home, rel), body);
};

test('override with body.md only: built-in meta and module, workspace body; hash covers both folders', () => withBase(async (ctx, home, base) => {
  const builtin = listTemplates(ctx, { dirs: [base] }).find((t) => t.id === 'sample-letter');
  put(home, 'templates/sample-letter/body.md', '# Private body\n\n{{person.name}}\n');
  const t = listTemplates(ctx, { dirs: [base] }).find((x) => x.id === 'sample-letter');
  assert.equal(t.source, 'workspace');
  assert.equal(t.path, join(home, 'templates', 'sample-letter'));
  assert.equal(t.inherits, join(base, 'sample-letter'));
  assert.equal(t.title, 'Sample letter', 'the built-in meta is used');
  assert.notEqual(t.hash, builtin.hash);
  assert.deepEqual(listTemplateErrors(ctx, { dirs: [base] }), []);

  const loaded = await getTemplate(ctx, 'sample-letter', { dirs: [base] });
  assert.equal(loaded.body, '# Private body\n\n{{person.name}}\n');
  assert.equal(typeof loaded.module.computed.annual, 'function', 'the built-in module is reused');
  assert.equal(typeof loaded.module.blocks, 'function');
  assert.equal(loaded.meta.title, 'Sample letter');
  const [row] = rows(ctx).filter((r) => r.id === 'sample-letter');
  assert.deepEqual([row.source, row.hash], ['workspace', t.hash]);

  writeFileSync(join(base, 'sample-letter', 'index.js'), `${readFileSync(join(base, 'sample-letter', 'index.js'), 'utf8')}\nexport const marker = 1;\n`);
  const t2 = listTemplates(ctx, { dirs: [base] }).find((x) => x.id === 'sample-letter');
  assert.notEqual(t2.hash, t.hash, 'the built-in module files are part of the hash');
  assert.equal((await getTemplate(ctx, 'sample-letter', { dirs: [base] })).module.marker, 1);
  writeFileSync(join(home, 'templates', 'sample-letter', 'body.md'), '# Changed\n');
  const t3 = listTemplates(ctx, { dirs: [base] }).find((x) => x.id === 'sample-letter');
  assert.notEqual(t3.hash, t2.hash, 'the workspace body is part of the hash');
}));

test('override with template.json only: workspace meta replaces the built-in meta, the module is reused', () => withBase(async (ctx, home, base) => {
  put(home, 'templates/sample-letter/template.json', FIXTURE_JSON.replace('"Sample letter"', '"Private letter"'));
  const t = await getTemplate(ctx, 'sample-letter', { dirs: [base] });
  assert.equal(t.source, 'workspace');
  assert.equal(t.meta.title, 'Private letter');
  assert.equal(t.body, undefined);
  assert.equal(typeof t.module.computed.annual, 'function');
  const builtinBody = listTemplates(ctx, { dirs: [base] }).find((x) => x.id === 'test-memo');
  put(home, 'templates/test-memo/template.json', readFileSync(join(base, 'test-memo', 'template.json'), 'utf8').replace('"Test memo"', '"Memo"'));
  const memo = await getTemplate(ctx, 'test-memo', { dirs: [base] });
  assert.equal(memo.meta.title, 'Memo');
  assert.equal(memo.body, readFileSync(join(base, 'test-memo', 'body.md'), 'utf8'), 'the built-in body is used when the override has none');
  assert.notEqual(memo.hash, builtinBody.hash);
}));

test('named bodies (body.<name>.md) load, and an override replaces them one file at a time', () => withBase(async (ctx, home, base) => {
  writeFileSync(join(base, 'test-memo', 'body.short.md'), 'Short {{text}}\n');
  writeFileSync(join(base, 'test-memo', 'body.long.md'), 'Long {{text}}\n');
  const builtin = await getTemplate(ctx, 'test-memo', { dirs: [base] });
  assert.deepEqual(builtin.bodies, { long: 'Long {{text}}\n', short: 'Short {{text}}\n' });
  put(home, 'templates/test-memo/body.short.md', 'Private short\n');
  const t = await getTemplate(ctx, 'test-memo', { dirs: [base] });
  assert.equal(t.body, builtin.body);
  assert.deepEqual(t.bodies, { long: 'Long {{text}}\n', short: 'Private short\n' });
}));

test('a broken override without index.js is reported and is not replaced by the built-in', async (t) => {
  const cases = {
    'bad JSON': [{ 'template.json': '{oops' }, /templates\/sample-letter\/template\.json: invalid JSON/],
    'id mismatch': [{ 'template.json': FIXTURE_JSON.replace('"id": "sample-letter"', '"id": "other"') }, /must match the folder name/],
    'computed function the built-in module lacks': [
      { 'template.json': FIXTURE_JSON.replace('"computed:annual"', '"computed:missing"') }, /index\.js exports no computed\.missing\(\)/],
  };
  for (const [name, [files, re]] of Object.entries(cases)) {
    await t.test(name, () => withBase(async (ctx, home, base) => {
      for (const [f, body] of Object.entries(files)) put(home, `templates/sample-letter/${f}`, body);
      const listed = listTemplates(ctx, { dirs: [base] });
      if (name.startsWith('computed')) {
        assert.equal(listed.find((x) => x.id === 'sample-letter').source, 'workspace');
      } else {
        assert.equal(listed.some((x) => x.id === 'sample-letter'), false);
        const [err] = listTemplateErrors(ctx, { dirs: [base] });
        assert.deepEqual([err.id, err.source, err.code], ['sample-letter', 'workspace', 'TEMPLATE_INVALID']);
        assert.match(err.message, re);
      }
      await assert.rejects(getTemplate(ctx, 'sample-letter', { dirs: [base] }), (e) => code('TEMPLATE_INVALID')(e) && re.test(e.message));
    }));
  }
  await t.test('body.md for an id with no built-in', () => withCtx(async (ctx, home) => {
    put(home, 'templates/nothing-here/body.md', '# Orphan\n');
    const [err] = listTemplateErrors(ctx);
    assert.equal(err.id, 'nothing-here');
    assert.match(err.message, /no template\.json and no built-in template "nothing-here" to inherit from/);
    await assert.rejects(getTemplate(ctx, 'nothing-here'), code('TEMPLATE_INVALID'));
  }));
  await t.test('index.js without template.json over a built-in', () => withBase(async (ctx, home, base) => {
    put(home, 'templates/sample-letter/index.js', 'export {};\n');
    const [err] = listTemplateErrors(ctx, { dirs: [base] });
    assert.equal(err.id, 'sample-letter');
    assert.match(err.message, /index\.js without template\.json: .*remove index\.js to inherit the built-in "sample-letter"/);
    assert.doesNotMatch(err.message, /no built-in template/);
  }));
  await t.test('a broken built-in is inherited as broken', () => withBase(async (ctx, home, base) => {
    writeFileSync(join(base, 'sample-letter', 'template.json'), '{oops');
    put(home, 'templates/sample-letter/body.md', '# Body\n');
    const [err] = listTemplateErrors(ctx, { dirs: [base] });
    assert.equal(err.source, 'workspace');
    assert.match(err.message, /inherits from a built-in template that does not load.*invalid JSON/s);
  }));
});
