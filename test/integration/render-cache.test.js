import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { tmpDir } from '../helpers/tmp.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext, refreshWorkspace } from '../../src/context.js';
import { upsertEntity } from '../../src/services/entities.js';
import { getTemplate } from '../../src/services/templates.js';
import { resolveTemplateFields } from '../../src/services/fields.js';
import { readRendition } from '../../src/services/documents.js';
import { generateDocument, previewDocument, renderWithCache } from '../../src/services/generator.js';
import { RENDER_CODE_PATHS, evictRenderCache, renderCacheDir, renderRuntime } from '../../src/cache/renderCache.js';
import { main } from '../../src/cli.js';

sharp.cache(false);
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'templates');
const INPUT = { person: 'Jordan Example', subject: 'Quarterly review', body: 'The review meeting moves to the second week.', date: '2026-06-01' };
const WHEN = new Date('2026-06-01T09:30:00Z');

async function withCtx(fn) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    const home = join(dir, 'ws');
    initWorkspace(home);
    const brandFile = join(home, 'brands', 'acme', 'brand.json');
    const brand = JSON.parse(readFileSync(brandFile, 'utf8'));
    brand.series['test-note'] = 'generic';
    writeFileSync(brandFile, JSON.stringify(brand, null, 2));
    ctx = openContext({ home, user: 'tester', env: {} });
    ctx.templateDirs = [FIXTURES];
    upsertEntity(ctx, { kind: 'person', name: 'Jordan Example' });
    upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited', brand: 'acme' });
    return await fn(ctx, home);
  } finally {
    ctx?.close();
    cleanup();
  }
}

/** Render test-note through the cache, as previewDocument / generateDocument do. */
async function render(ctx, { input = INPUT, creationDate = WHEN, draft = true, number = null } = {}) {
  const template = await getTemplate(ctx, 'test-note');
  const { values } = resolveTemplateFields(ctx, template, input, { brandId: 'acme', today: '2026-06-01' });
  return renderWithCache(ctx, template, values, { brand: 'acme', draft, number, creationDate, input });
}

const entries = (ctx) => (existsSync(renderCacheDir(ctx)) ? readdirSync(renderCacheDir(ctx)) : []);
const metaFiles = (ctx) => entries(ctx).filter((f) => /^[0-9a-f]{64}\.json$/.test(f));
const png = (r, g, b) => sharp({ create: { width: 40, height: 20, channels: 3, background: { r, g, b } } }).png().toBuffer();

test('a hit returns byte-identical renditions, equal to a fresh render without the cache', () => withCtx(async (ctx) => {
  const first = await render(ctx);
  assert.equal(first.cached, false);
  assert.deepEqual(first.map((r) => r.kind), ['pdf', 'html', 'md']);
  const files = entries(ctx);
  for (const r of first) assert.ok(files.some((f) => f.endsWith(`.${r.kind}`)), `${r.kind} stored`);
  assert.equal(metaFiles(ctx).length, 1);

  const second = await render(ctx);
  assert.equal(second.cached, true);
  assert.deepEqual(second.map((r) => [r.kind, r.mime]), first.map((r) => [r.kind, r.mime]));
  assert.deepEqual(second.warnings, first.warnings);
  second.forEach((r, i) => assert.ok(r.buffer.equals(first[i].buffer), `${r.kind} identical`));

  ctx.config.renderCacheMb = 0; // off: render again from scratch
  const fresh = await render(ctx);
  assert.equal(fresh.cached, false);
  fresh.forEach((r, i) => assert.ok(r.buffer.equals(first[i].buffer), `${r.kind} identical to a fresh render`));
}));

test('the key covers values, number, draft flag and creation date', () => withCtx(async (ctx) => {
  await render(ctx);
  assert.equal((await render(ctx, { input: { ...INPUT, subject: 'Another subject' } })).cached, false);
  assert.equal((await render(ctx, { creationDate: new Date('2026-06-02T00:00:00Z') })).cached, false);
  assert.equal((await render(ctx, { draft: false, number: 'ACME-1' })).cached, false);
  assert.equal((await render(ctx, { draft: false, number: 'ACME-2' })).cached, false);
  assert.equal((await render(ctx, { draft: false, number: 'ACME-1' })).cached, true);
  assert.equal((await render(ctx)).cached, true);
}));

test('a brand configuration change invalidates; so does changing an asset file the render used, but not an unused one', () => withCtx(async (ctx, home) => {
  const before = await render(ctx);
  assert.equal((await render(ctx)).cached, true);

  // test-note signs with the letter signatory (md): the other signatory's file is not used, so adding it leaves the
  // key alone; the seal is drawn, so adding the file the brand names is a miss.
  const assets = join(home, 'brands', 'acme', 'assets');
  writeFileSync(join(assets, 'sign-ops.png'), await png(200, 0, 0));
  assert.equal((await render(ctx)).cached, true);
  writeFileSync(join(assets, 'seal.png'), await png(200, 0, 0));
  assert.equal((await render(ctx)).cached, false);
  assert.equal((await render(ctx)).cached, true);

  // The logo is: the brand's own file now shadows the shipped placeholder, then its bytes change.
  writeFileSync(join(assets, 'logo.png'), await png(0, 0, 200));
  const withLogo = await render(ctx);
  assert.equal(withLogo.cached, false);
  assert.ok(!withLogo[0].buffer.equals(before[0].buffer));
  assert.equal((await render(ctx)).cached, true);
  writeFileSync(join(assets, 'logo.png'), await png(0, 200, 0));
  assert.equal((await render(ctx)).cached, false);
  assert.equal((await render(ctx)).cached, true);

  const brandFile = join(home, 'brands', 'acme', 'brand.json');
  const brand = JSON.parse(readFileSync(brandFile, 'utf8'));
  brand.shortName = 'Acme Renamed';
  writeFileSync(brandFile, JSON.stringify(brand, null, 2));
  assert.equal(refreshWorkspace(ctx).reloaded, true);
  assert.equal((await render(ctx)).cached, false);
  assert.equal((await render(ctx)).cached, true);
}));

test('the key includes the render code hash and library versions, computed once', () => {
  const rt = renderRuntime();
  assert.match(rt.code, /^[0-9a-f]{64}$/);
  assert.match(rt.pdfkit, /^\d+\.\d+\.\d+/);
  assert.match(rt.fontkit, /^\d+\.\d+\.\d+/);
  assert.match(rt.sharp, /^\d+\.\d+\.\d+/);
  assert.equal(renderRuntime(), rt);
});

test('a damaged entry is a miss and is rewritten', () => withCtx(async (ctx) => {
  await render(ctx);
  const pdf = entries(ctx).find((f) => f.endsWith('.pdf'));
  writeFileSync(join(renderCacheDir(ctx), pdf), 'not a pdf');
  assert.equal((await render(ctx)).cached, false);
  assert.equal((await render(ctx)).cached, true);
}));

test('the folder is trimmed to the size bound, least recently used (atime) first', () => withCtx(async (ctx) => {
  const a = await render(ctx, { input: { ...INPUT, subject: 'A' } });
  const size = entries(ctx).reduce((n, f) => n + statSync(join(renderCacheDir(ctx), f)).size, 0);
  ctx.config.renderCacheMb = (size * 1.5) / (1024 * 1024); // room for one entry, not two
  await render(ctx, { input: { ...INPUT, subject: 'B' } });
  assert.equal(metaFiles(ctx).length, 1, 'the older entry was evicted whole');
  assert.equal(entries(ctx).filter((f) => !f.endsWith('.assets.json')).length, 4, 'pdf, html, md and meta of B');
  assert.equal((await render(ctx, { input: { ...INPUT, subject: 'B' } })).cached, true);
  const again = await render(ctx, { input: { ...INPUT, subject: 'A' } });
  assert.equal(again.cached, false);
  assert.ok(again[0].buffer.equals(a[0].buffer));
}));

test('evictRenderCache removes the files with the oldest atime until the folder fits', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const t = Date.now() / 1000;
    const key = (c) => c.repeat(64);
    // Entry a: two files, one used recently (the entry counts as recent); entry b: old; c: a lone manifest.
    for (const [name, age] of [[`${key('a')}.pdf`, 400], [`${key('a')}.json`, 50], [`${key('b')}.pdf`, 300], [`${key('c')}.assets.json`, 200]]) {
      writeFileSync(join(dir, name), Buffer.alloc(100));
      utimesSync(join(dir, name), t - age, t - age);
    }
    assert.deepEqual(evictRenderCache(dir, 400), { files: 0, bytes: 0 });
    assert.deepEqual(evictRenderCache(dir, 250), { files: 2, bytes: 200 });
    assert.deepEqual(readdirSync(dir).sort(), [`${key('a')}.json`, `${key('a')}.pdf`]);
    assert.deepEqual(evictRenderCache(dir, 0), { files: 2, bytes: 200 });
    assert.deepEqual(evictRenderCache(join(dir, 'missing'), 0), { files: 0, bytes: 0 });
  } finally {
    cleanup();
  }
});

test('previews of one day are byte-identical and come from the cache', () => withCtx(async (ctx) => {
  const one = await previewDocument(ctx, 'test-note', INPUT, { today: '2026-06-01' });
  assert.equal(metaFiles(ctx).length, 1);
  const pdf1 = readFileSync(one.renditions[0].path);
  const two = await previewDocument(ctx, 'test-note', INPUT, { today: '2026-06-01' });
  assert.equal(metaFiles(ctx).length, 1, 'no new entry: served from the cache');
  assert.ok(readFileSync(two.renditions[0].path).equals(pdf1));
  assert.match(pdf1.toString('latin1'), /\(D:20260601000000Z/);
  await previewDocument(ctx, 'test-note', INPUT, { today: '2026-06-02' });
  assert.equal(metaFiles(ctx).length, 2, 'another day, another creation date');
}));

test('final generations go through the cache and still store blobs; creationDate is part of the key', () => withCtx(async (ctx) => {
  const v1 = await generateDocument(ctx, 'test-note', INPUT, { creationDate: WHEN });
  const id = v1.documentId;
  const n = metaFiles(ctx).length;
  // The recipient's documentCount changed with v1, so v2's values differ; v3 repeats v2 exactly.
  const v2 = await generateDocument(ctx, 'test-note', INPUT, { documentId: id, creationDate: WHEN });
  assert.equal(metaFiles(ctx).length, n + 1);
  const v3 = await generateDocument(ctx, 'test-note', INPUT, { documentId: id, creationDate: WHEN });
  assert.equal(metaFiles(ctx).length, n + 1, 'v3 was served from the cache');
  assert.equal(v3.versionNo, 3);
  assert.deepEqual(v3.renditions.map((r) => r.sha256), v2.renditions.map((r) => r.sha256));
  const stored = readRendition(ctx, id, { kind: 'pdf', versionNo: 3 });
  assert.equal(stored.sha256, v3.renditions[0].sha256);
  assert.match(stored.buffer.toString('latin1'), /\(D:20260601093000Z/);

  // The default creation date is now: a new key.
  await generateDocument(ctx, 'test-note', INPUT, { documentId: id });
  assert.equal(metaFiles(ctx).length, n + 2);
  await assert.rejects(generateDocument(ctx, 'test-note', INPUT, { documentId: id, creationDate: 'not a date' }), /creationDate/);
}));

test('DOSSIER_RENDER_CACHE_MB=0 turns the cache off', () => withCtx(async (ctx) => {
  ctx.config.renderCacheMb = 0;
  await render(ctx);
  assert.equal((await render(ctx)).cached, false);
  assert.deepEqual(entries(ctx), []);
}));

test('dossier cache clear empties the render cache', () => withCtx(async (ctx, home) => {
  await render(ctx);
  assert.ok(entries(ctx).length > 0);
  mkdirSync(join(home, 'data', 'previews'), { recursive: true });
  const out = [];
  const io = { env: { DOSSIER_HOME: home }, cwd: home, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) } };
  assert.equal(await main(['cache', 'clear'], io), 0);
  assert.match(out.join(''), /^Cleared \d+ cached files \(\d+\.\d MB\) from .*cache[\\/]render\n$/);
  assert.deepEqual(entries(ctx), []);
  assert.equal((await render(ctx)).cached, false);
  out.length = 0;
  assert.equal(await main(['cache'], io), 1);
  assert.equal(await main(['cache', 'purge'], io), 1);
  assert.match(out.join(''), /expected: cache clear/);
}));

test('every module the render layer and templates import is part of the render code hash', () => {
  const root = join(import.meta.dirname, '..', '..');
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  for (const p of ['src/render', 'src/templates']) walk(join(root, p));
  const outside = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
      const r = relative(root, resolve(dirname(f), m[1])).split('\\').join('/');
      if (!RENDER_CODE_PATHS.some((c) => r === c || r.startsWith(`${c}/`))) outside.add(r);
    }
  }
  // errors.js only defines the error class; it never shapes rendered bytes.
  assert.deepEqual([...outside].sort(), ['src/errors.js']);
  assert.ok(RENDER_CODE_PATHS.includes('src/services/fields.js'), 'proposalTemplate imports coerceMoney from services/fields.js');
});
