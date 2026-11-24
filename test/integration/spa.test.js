import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { buildServer, PAGE_CSP, SPA_CSP } from '../../src/server.js';

const INDEX = '<!doctype html><html><head><title>Dossier</title></head><body><div id="root"></div></body></html>';
let tmp; let ctx; let app; let bare;

before(async () => {
  tmp = tmpDir();
  const home = join(tmp.dir, 'ws');
  initWorkspace(home);
  ctx = openContext({ home, user: 'demo', env: {} });
  const dist = join(tmp.dir, 'dist');
  mkdirSync(join(dist, 'app'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'app', 'x.js'), 'console.log(1);\n');
  writeFileSync(join(dist, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  app = buildServer(ctx, { spaDir: dist });
  bare = buildServer(ctx, { spaDir: join(tmp.dir, 'no-dist') });
});

after(async () => {
  await app?.close();
  await bare?.close();
  ctx?.close();
  tmp?.cleanup();
});

describe('SPA serving', () => {
  test('SPA_CSP pins the page policy for the web app', () => {
    assert.equal(SPA_CSP, "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
      + "font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    assert.notEqual(PAGE_CSP, SPA_CSP);
  });

  test('unmatched client routes fall back to index.html with SPA_CSP', async () => {
    for (const url of ['/dashboard', '/vault/03%20Clients/Acme', '/documents/DOC-000001/history?tab=x']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 200, url);
      assert.match(r.headers['content-type'], /^text\/html/);
      assert.equal(r.body, INDEX);
      assert.equal(r.headers['content-security-policy'], SPA_CSP);
      assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
      assert.equal(r.headers['cache-control'], 'no-store');
    }
    const head = await app.inject({ method: 'HEAD', url: '/dashboard' });
    assert.equal(head.statusCode, 200);
    assert.match(head.headers['content-type'], /^text\/html/);
    assert.equal(head.body, '');
  });

  test('old pages keep their routes and their CSP until the switch-over', async () => {
    const home = await app.inject({ url: '/' });
    assert.equal(home.statusCode, 200);
    assert.notEqual(home.body, INDEX);
    assert.equal(home.headers['content-security-policy'], PAGE_CSP);
    const search = await app.inject({ url: '/search' });
    assert.equal(search.statusCode, 200);
    assert.notEqual(search.body, INDEX);
    for (const url of ['/settings/nowhere', '/entities/x/y/z', '/search/x']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 404, url);
      assert.equal(r.headers['content-security-policy'], PAGE_CSP, url);
    }
  });

  test('API, JSON-accepting and non-GET requests to unknown paths answer JSON 404', async () => {
    const apiMiss = await app.inject({ url: '/api/nope' });
    assert.equal(apiMiss.statusCode, 404);
    assert.equal(apiMiss.json().code, 'NOT_FOUND');
    const json = await app.inject({ url: '/dashboard', headers: { accept: 'application/json' } });
    assert.equal(json.statusCode, 404);
    assert.equal(json.json().code, 'NOT_FOUND');
    const post = await app.inject({ method: 'POST', url: '/dashboard', headers: { origin: 'http://localhost:80', accept: 'application/json' } });
    assert.equal(post.statusCode, 404);
  });

  test('file namespaces never fall back to the web app', async () => {
    for (const url of ['/workspace.json', '/robots.txt', '/app/missing.js', '/assets/nope.png', '/blobs/x', '/previews/x', '/brand/x.png', '/documents/DOC-1/renditions/pdf', '/static/nope.css']) {
      const r = await app.inject({ url });
      assert.ok(r.statusCode === 404 || (url.includes('/renditions/') && r.statusCode === 400), `${url}: ${r.statusCode}`);
      assert.notEqual(r.body, INDEX, url);
    }
  });

  test('hashed bundle files are immutable; other dist files revalidate', async () => {
    const js = await app.inject({ url: '/app/x.js' });
    assert.equal(js.statusCode, 200);
    assert.match(js.headers['content-type'], /javascript/);
    assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable');
    const ico = await app.inject({ url: '/favicon.ico' });
    assert.equal(ico.statusCode, 200);
    assert.equal(ico.headers['cache-control'], 'public, max-age=0');
    const idx = await app.inject({ url: '/index.html' });
    assert.equal(idx.statusCode, 200);
    assert.equal(idx.headers['content-security-policy'], SPA_CSP);
  });

  test('a missing build answers 503 with a one-line page and never crashes', async () => {
    const r = await bare.inject({ url: '/dashboard' });
    assert.equal(r.statusCode, 503);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.match(r.body, /npm run build/);
    assert.equal(r.body.trim().split('\n').length, 1);
    const api = await bare.inject({ url: '/api/nope' });
    assert.equal(api.statusCode, 404);
    assert.equal(api.json().code, 'NOT_FOUND');
    assert.equal((await bare.inject({ url: '/favicon.ico' })).statusCode, 404);
    assert.equal((await bare.inject({ url: '/' })).statusCode, 200);
  });
});
