import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { fakeSpaDir } from '../helpers/spa.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { buildServer } from '../../src/server.js';
import { STATUSES, TRANSITIONS } from '../../src/domain/status.js';
import { LEVELS } from '../../src/domain/sensitivity.js';
import { DEFAULT_ROUTES, TOP_LEAVES, TOP_LEVEL } from '../../src/domain/routing.js';
import { ASSET_MAX_BYTES, builtinFonts } from '../../src/services/workspaceFiles.js';
import { REPO_ROOT } from '../../src/paths.js';

let tmp; let ctx; let internCtx; let app; let internApp;

before(() => {
  tmp = tmpDir();
  const home = join(tmp.dir, 'ws');
  initWorkspace(home);
  const wsFile = join(home, 'workspace.json');
  const ws = JSON.parse(readFileSync(wsFile, 'utf8'));
  ws.users = { ...ws.users, intern: { clearance: 'Internal' } };
  writeFileSync(wsFile, JSON.stringify(ws, null, 2));
  ctx = openContext({ home, user: 'demo', env: {} });
  internCtx = openContext({ home, user: 'intern', env: {} });
  const spaDir = fakeSpaDir(tmp.dir);
  app = buildServer(ctx, { fileSizeLimit: 1234, spaDir });
  internApp = buildServer(internCtx, { spaDir });
});

after(async () => {
  await app?.close();
  await internApp?.close();
  ctx?.close();
  internCtx?.close();
  tmp?.cleanup();
});

describe('GET /api/me', () => {
  test('shape: user with clearance, workspace, brands, version', async () => {
    const r = await app.inject({ url: '/api/me' });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'], /application\/json/);
    const me = r.json();
    assert.deepEqual(Object.keys(me).sort(), ['brands', 'user', 'version', 'workspace']);
    assert.deepEqual(me.user, { id: 'demo', clearance: ctx.user.clearance });
    assert.deepEqual(Object.keys(me.workspace).sort(), ['dataDir', 'defaultBrand', 'home', 'locale', 'name']);
    assert.equal(me.workspace.name, ctx.ws.config.name);
    assert.equal(me.workspace.defaultBrand, ctx.ws.config.defaultBrand);
    assert.equal(me.workspace.home, ctx.config.home);
    assert.equal(me.workspace.dataDir, ctx.config.dataDir);
    assert.equal(me.workspace.locale.numberLocale, ctx.ws.config.locale.numberLocale);
    assert.ok(me.brands.length >= 1);
    for (const b of me.brands) assert.deepEqual(Object.keys(b).sort(), ['id', 'legalName', 'shortName']);
    assert.ok(me.brands.some((b) => b.id === ctx.ws.config.defaultBrand));
    assert.equal(me.version, JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version);
  });

  test('shows the acting user\'s clearance', async () => {
    const me = (await internApp.inject({ url: '/api/me' })).json();
    assert.deepEqual(me.user, { id: 'intern', clearance: 'Internal' });
  });
});

describe('GET /api/meta', () => {
  test('lifecycle and enumerations come from the domain modules', async () => {
    const r = await app.inject({ url: '/api/meta' });
    assert.equal(r.statusCode, 200);
    const m = r.json();
    assert.deepEqual(m.statuses, STATUSES);
    assert.deepEqual(m.transitions, TRANSITIONS);
    assert.deepEqual(m.sensitivityLevels, LEVELS);
    assert.deepEqual(m.clearances, LEVELS);
    assert.ok(m.relationTypes.includes('supersedes'));
    assert.ok(m.entityRoles.includes('party'));
    assert.ok(m.partyTypes.includes('Client'));
    assert.ok(m.entityKinds.includes('client'));
    assert.ok(m.entityRelationRoles.includes('employed_by'));
    assert.ok(m.seriesScopes.includes('brand+year'));
    assert.ok(m.fontWeights.includes('bold'));
    assert.deepEqual(m.builtinFonts, builtinFonts());
    assert.ok(m.builtinFonts.every((f) => f.startsWith('builtin:')));
    assert.deepEqual(m.documentTypes, Object.keys(DEFAULT_ROUTES));
    assert.deepEqual(m.hierarchy.topLevel, TOP_LEVEL);
    assert.deepEqual(m.hierarchy.leaves, TOP_LEAVES);
    assert.equal(m.hierarchy.defaultLeaf, 'Other');
    assert.equal(m.hierarchy.topKeys.length, TOP_LEVEL.length);
    assert.ok(m.templateCategories.includes('invoice'));
    assert.ok(m.fieldTypes.includes('money'));
    assert.deepEqual(m.limits, { assetMaxBytes: ASSET_MAX_BYTES, uploadMaxBytes: 1234 });
  });

  test('default upload limit is reported', async () => {
    const m = (await internApp.inject({ url: '/api/meta' })).json();
    assert.equal(m.limits.uploadMaxBytes, 50 * 1024 * 1024);
  });
});

describe('GET /api/meta hierarchy names', () => {
  test('reflects the workspace\'s own hierarchy.topLevel names', async () => {
    const t = tmpDir();
    const home = join(t.dir, 'ws');
    initWorkspace(home);
    const wsFile = join(home, 'workspace.json');
    const ws = JSON.parse(readFileSync(wsFile, 'utf8'));
    const renamed = TOP_LEVEL.map((n, i) => (i === 0 ? '00 Our Company' : n));
    ws.hierarchy = { ...ws.hierarchy, topLevel: renamed };
    writeFileSync(wsFile, JSON.stringify(ws, null, 2));
    const c = openContext({ home, user: 'demo', env: {} });
    const a = buildServer(c, { spaDir: fakeSpaDir(t.dir) });
    try {
      const m = (await a.inject({ url: '/api/meta' })).json();
      assert.deepEqual(m.hierarchy.topLevel, renamed);
      assert.notDeepEqual(m.hierarchy.topLevel, TOP_LEVEL);
      assert.equal(m.hierarchy.topKeys.length, renamed.length);
    } finally {
      await a.close();
      c.close();
      t.cleanup();
    }
  });
});
