import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { buildServer, SPA_CSP } from '../../src/server.js';

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
  mkdirSync(join(dist, 'brand'));
  writeFileSync(join(dist, 'brand', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dist, 'brand', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dist, 'site.webmanifest'), '{"name":"Dossier"}');
  writeFileSync(join(tmp.dir, 'outside.txt'), 'OUTSIDE THE BUILD');
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
  test('SPA_CSP pins the one HTML policy', () => {
    assert.equal(SPA_CSP, "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
      + "font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
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

  test('the web app owns / and the paths the removed server-rendered pages used', async () => {
    for (const url of ['/', '/?node=01', '/search', '/search/x', '/upload', '/generate/invoice', '/templates', '/entities/x/y/z', '/settings/nowhere']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 200, url);
      assert.equal(r.body, INDEX, url);
      assert.equal(r.headers['content-security-policy'], SPA_CSP, url);
    }
    const head = await app.inject({ method: 'HEAD', url: '/' });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, '');
  });

  test('a wrong-case spelling of a build file is a 404 whether or not the file exists', async () => {
    // On a case-insensitive disk the static plugin sees /APP/x.js as an alias of app/x.js and refuses it (403); on a
    // case-sensitive one it is simply missing. Both must answer the same JSON 404.
    for (const url of ['/APP/x.js', '/app/X.JS', '/APP/missing.js', '/BRAND/icon-192.png', '/Site.webmanifest', '/INDEX.HTML']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 404, `${url}: ${r.statusCode}`);
      assert.equal(r.json().code, 'NOT_FOUND', url);
    }
  });

  test('a directory of the build is a 404, never a 403 or the web app', async () => {
    for (const url of ['/app/', '/brand/', '/app', '/brand', '/assets/fonts/', '/assets/fonts/Manrope/']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 404, url);
      assert.equal(r.json().code, 'NOT_FOUND', url);
    }
  });

  test('percent-encoded paths: file namespaces stay files, /api stays JSON, `..` never leaves the build', async () => {
    const js = await app.inject({ url: '/%61pp/x.js' });
    assert.equal(js.statusCode, 200);
    assert.match(js.headers['content-type'], /javascript/);
    for (const url of ['/%61pp/missing.js', '/%62rand/missing.png', '/%61pi/nope', '/%41PI/nope', '/documents/DOC-1/%72enditions', '//api/x', '/api;x', '/API/x', '//app/x.js', '/app;x.js']) {
      const r = await app.inject({ url });
      assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${url}: ${r.statusCode}`);
      assert.notEqual(r.body, INDEX, url);
    }
    for (const url of ['/%2e%2e/outside.txt', '/app/%2e%2e/%2e%2e/outside.txt', '/app/..%2f..%2foutside.txt', '/%2e%2e%2foutside.txt',
      '/app/%252e%252e/%252e%252e/outside.txt', '/brand/..%5c..%5coutside.txt']) {
      const r = await app.inject({ url });
      assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${url}: ${r.statusCode}`);
      assert.doesNotMatch(r.body, /OUTSIDE THE BUILD/, url);
      assert.notEqual(r.body, INDEX, url);
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
    assert.equal(idx.headers['cache-control'], 'no-store', 'index.html is never stored, like the fallback');
  });

  test('brand icons and the web manifest are served from the build, revalidated, never the web app', async () => {
    for (const [url, type] of [['/brand/icon-192.png', /^image\/png/], ['/brand/favicon.svg', /^image\/svg\+xml/], ['/site.webmanifest', /^application\/manifest\+json/]]) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 200, url);
      assert.match(r.headers['content-type'], type, url);
      assert.equal(r.headers['cache-control'], 'public, max-age=0', url);
      assert.ok(r.headers.etag || r.headers['last-modified'], `${url} has a validator`);
      assert.notEqual(r.body, INDEX, url);
    }
    for (const url of ['/brand/missing.png', '/brand/sub/x.svg']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 404, url);
      assert.notEqual(r.body, INDEX, url);
    }
    assert.equal((await bare.inject({ url: '/site.webmanifest' })).statusCode, 404);
    assert.equal((await bare.inject({ url: '/brand/icon-192.png' })).statusCode, 404);
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
    assert.equal((await bare.inject({ url: '/' })).statusCode, 503);
  });

  test('a rebuild under a running server serves the new index.html (re-read when its mtime or size changes)', async () => {
    const dist = join(tmp.dir, 'rebuilt');
    mkdirSync(dist, { recursive: true });
    const file = join(dist, 'index.html');
    const v1 = '<!doctype html><script type="module" src="/app/index-aaaa.js"></script>';
    writeFileSync(file, v1);
    const server = buildServer(ctx, { spaDir: dist });
    try {
      assert.equal((await server.inject({ url: '/dashboard' })).body, v1);
      // Same size, different bytes and mtime: still noticed.
      const v2 = v1.replace('aaaa', 'bbbb');
      writeFileSync(file, v2);
      utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
      assert.equal((await server.inject({ url: '/dashboard' })).body, v2);
      // Different size, written within the same mtime tick: noticed by size.
      const st = statSync(file);
      const v3 = v2.replace('index-bbbb', 'index-cccccc');
      writeFileSync(file, v3);
      utimesSync(file, st.atime, st.mtime);
      assert.equal((await server.inject({ url: '/' })).body, v3);
      // Removed mid-rebuild: the not-built page, then the new index once it is back.
      rmSync(file);
      assert.equal((await server.inject({ url: '/dashboard' })).statusCode, 503);
      writeFileSync(file, v1);
      assert.equal((await server.inject({ url: '/dashboard' })).body, v1);
    } finally {
      await server.close();
    }
  });
});
