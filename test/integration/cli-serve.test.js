import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { main } from '../../src/cli.js';
import { openContext } from '../../src/context.js';
import { findEntities } from '../../src/services/entities.js';

const capture = () => ({ text: '', write(s) { this.text += s; return true; } });

test('init seeds the new workspace; seed is idempotent', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const out = capture(); const err = capture();
    const home = join(dir, 'ws');
    assert.equal(await main(['init', home], { stdout: out, stderr: err, env: {}, cwd: dir }), 0, err.text);
    assert.match(out.text, /Seeded 13 entities/);
    const ctx = openContext({ home, user: 'demo', env: {} });
    try {
      assert.equal(findEntities(ctx, { q: 'Demo Retail', kind: 'client' })[0].name, 'Demo Retail LLP');
    } finally {
      ctx.close();
    }
    const again = capture();
    assert.equal(await main(['seed'], { stdout: again, stderr: err, env: { DOSSIER_HOME: home }, cwd: dir }), 0, err.text);
    assert.match(again.text, /Seeded 0 entities \(0 updated\), 0 aliases, 0 relations/);
    assert.equal(await main(['seed', 'extra'], { stdout: capture(), stderr: err, env: { DOSSIER_HOME: home }, cwd: dir }), 1);
  } finally {
    cleanup();
  }
});

test('serve listens on 127.0.0.1 and stops when the signal aborts', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const home = join(dir, 'ws');
    const err = capture();
    assert.equal(await main(['init', home], { stdout: capture(), stderr: err, env: {}, cwd: dir }), 0, err.text);
    const out = capture();
    const ac = new AbortController();
    const running = main(['serve', '--port', '0'], { stdout: out, stderr: err, env: { DOSSIER_HOME: home, DOSSIER_USER: 'demo' }, cwd: dir, signal: ac.signal });
    for (let i = 0; i < 100 && !/running at/.test(out.text) && !err.text; i++) await delay(20);
    const url = out.text.match(/running at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    assert.ok(url, out.text + err.text);
    const res = await fetch(`${url}/api/tree`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, '');
    ac.abort();
    assert.equal(await running, 0);
    assert.equal(await main(['serve', '--port', 'x'], { stdout: capture(), stderr: capture(), env: { DOSSIER_HOME: home }, cwd: dir }), 1);
  } finally {
    cleanup();
  }
});
