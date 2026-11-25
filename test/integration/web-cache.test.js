import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { tmpDir } from '../helpers/tmp.js';
import { fakeSpaDir } from '../helpers/spa.js';
import { makePdf } from '../helpers/pdf.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { seedEntities, upsertEntity } from '../../src/services/entities.js';
import { createDocument, addVersion } from '../../src/services/documents.js';
import { previewDocument } from '../../src/services/generator.js';
import { buildServer } from '../../src/server.js';
import { etagMatches } from '../../src/web/http.js';

sharp.cache(false);
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'templates');
const YEAR_PRIVATE = 'private, max-age=31536000, immutable';
const YEAR_PUBLIC = 'public, max-age=31536000, immutable';
let tmp; let ctx; let app; let internCtx; let internApp; let home;
let secret; let sha; // a Confidential document the Internal user may not read, and its PDF's sha256

const get = (url, headers = {}, server = app) => server.inject({ url, headers });

before(async () => {
  tmp = tmpDir();
  home = join(tmp.dir, 'ws');
  initWorkspace(home);
  const wsFile = join(home, 'workspace.json');
  const ws = JSON.parse(readFileSync(wsFile, 'utf8'));
  ws.users = { ...ws.users, intern: { clearance: 'Internal' } };
  writeFileSync(wsFile, JSON.stringify(ws, null, 2));
  writeFileSync(join(home, 'brands', 'acme', 'assets', 'logo.png'),
    await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 0, g: 0, b: 200 } } }).png().toBuffer());

  ctx = openContext({ home, user: 'demo', env: {} });
  ctx.templateDirs = [FIXTURES];
  seedEntities(ctx);
  upsertEntity(ctx, { kind: 'person', name: 'Jordan Example' });
  internCtx = openContext({ home, user: 'intern', env: {} });
  const spaDir = fakeSpaDir(tmp.dir);
  app = buildServer(ctx, { spaDir });
  internApp = buildServer(internCtx, { spaDir });

  const pdf = await makePdf(['Confidential board minutes about the sample merger']);
  sha = createHash('sha256').update(pdf).digest('hex');
  secret = createDocument(ctx, { type: 'Board Resolution', title: 'Secret minutes', sensitivity: 'Confidential' });
  addVersion(ctx, secret.id, { renditions: [{ kind: 'pdf', buffer: pdf, filename: 'minutes.pdf', mime: 'application/pdf' }] });
});

after(async () => {
  await app?.close();
  await internApp?.close();
  ctx?.close();
  internCtx?.close();
  tmp?.cleanup();
});

test('etagMatches reads If-None-Match lists, weak tags and *', () => {
  assert.equal(etagMatches(undefined, 'abc'), false);
  assert.equal(etagMatches('"abc"', 'abc'), true);
  assert.equal(etagMatches('"x", W/"abc"', 'abc'), true);
  assert.equal(etagMatches('*', 'abc'), true);
  assert.equal(etagMatches('abc', 'abc'), false, 'an unquoted value is not a tag');
  assert.equal(etagMatches('"abcd"', 'abc'), false);
});

test('blobs: ETag, private immutable caching, 304 on If-None-Match', async () => {
  const url = `/blobs/${sha}/minutes.pdf`;
  const res = await get(url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.etag, `"${sha}"`);
  assert.equal(res.headers['cache-control'], YEAR_PRIVATE);
  for (const inm of [`"${sha}"`, `W/"${sha}"`, `"other", "${sha}"`]) {
    const again = await get(url, { 'if-none-match': inm });
    assert.equal(again.statusCode, 304, inm);
    assert.equal(again.body, '');
    assert.equal(again.headers.etag, `"${sha}"`);
    assert.equal(again.headers['cache-control'], YEAR_PRIVATE);
  }
  assert.equal((await get(url, { 'if-none-match': '"other"' })).statusCode, 200);
});

test('a conditional request from a user below the clearance gets 403, never 304', async () => {
  for (const url of [`/blobs/${sha}/minutes.pdf`, `/documents/${secret.id}/renditions/pdf`, `/api/documents/${secret.id}/renditions/pdf`]) {
    const res = await get(url, { 'if-none-match': `"${sha}"` }, internApp);
    assert.equal(res.statusCode, 403, url);
    assert.equal(res.headers.etag, undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('renditions by document: ETag of the blob, private revalidation, 304', async () => {
  for (const url of [`/documents/${secret.id}/renditions/pdf`, `/api/documents/${secret.id}/renditions/pdf?version=1`]) {
    const res = await get(url);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.etag, `"${sha}"`);
    assert.equal(res.headers['cache-control'], 'private, no-cache');
    assert.equal((await get(url, { 'if-none-match': `"${sha}"` })).statusCode, 304);
  }
});

test('API JSON, pages, redirects and errors are no-store', async () => {
  for (const url of ['/api/documents', `/api/documents/${secret.id}`, '/', `/documents/${secret.id}`, '/search?q=minutes', '/nowhere', '/api/nowhere']) {
    const res = await get(url);
    assert.equal(res.headers['cache-control'], 'no-store', url);
    assert.equal(res.headers.etag, undefined, url);
  }
});

test('previews: ETag of the bytes, no-cache, 304', async () => {
  const p = await previewDocument(ctx, 'test-note', { person: 'Jordan Example', subject: 'Hello', body: 'Text.', date: '2026-06-01' }, { today: '2026-06-01' });
  assert.equal(p.ok, true);
  const url = `/previews/${p.token}/preview.pdf`;
  const res = await get(url);
  assert.equal(res.statusCode, 200);
  const etag = `"${createHash('sha256').update(res.rawPayload).digest('hex')}"`;
  assert.equal(res.headers.etag, etag);
  assert.equal(res.headers['cache-control'], 'private, no-cache');
  assert.equal((await get(url, { 'if-none-match': etag })).statusCode, 304);
});

test('brand assets: ETag of the file; immutable only when ?v= names its hash', async () => {
  const logo = readFileSync(join(home, 'brands', 'acme', 'assets', 'logo.png'));
  const hash = createHash('sha256').update(logo).digest('hex');
  const plain = await get('/assets/brands/acme/logo');
  assert.equal(plain.statusCode, 200);
  assert.ok(plain.rawPayload.equals(logo));
  assert.equal(plain.headers.etag, `"${hash}"`);
  assert.equal(plain.headers['cache-control'], 'public, no-cache');
  assert.equal((await get(`/assets/brands/acme/logo?v=${hash.slice(0, 12)}`)).headers['cache-control'], YEAR_PUBLIC);
  assert.equal((await get('/assets/brands/acme/logo?v=000000000000')).headers['cache-control'], 'public, no-cache');
  const cond = await get('/assets/brands/acme/logo', { 'if-none-match': `"${hash}"` });
  assert.equal(cond.statusCode, 304);
  assert.equal(cond.body, '');

  const font = await get('/assets/brands/acme/fonts/regular');
  assert.equal(font.statusCode, 200);
  assert.match(font.headers.etag, /^"[0-9a-f]{64}"$/);

  // The brand asset API hands the web app the logo URL pinned with its content hash.
  const assets = (await get('/api/brands/acme/assets')).json().assets;
  assert.equal(assets.find((a) => a.key === 'assets.logo').url, `/assets/brands/acme/logo?v=${hash.slice(0, 12)}`);
});

test('shipped fonts and web app files revalidate (public, max-age=0) and answer 304', async () => {
  for (const url of ['/assets/fonts/Manrope/Manrope-Regular.ttf', '/favicon.ico']) {
    const res = await get(url);
    assert.equal(res.statusCode, 200, url);
    assert.equal(res.headers['cache-control'], 'public, max-age=0', url);
    assert.ok(res.headers.etag, url);
    assert.equal((await get(url, { 'if-none-match': res.headers.etag })).statusCode, 304, url);
  }
});
