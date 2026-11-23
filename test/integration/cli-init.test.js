import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from '../helpers/tmp.js';
import { main } from '../../src/cli.js';
import { loadWorkspace } from '../../src/workspace/index.js';

const BIN = fileURLToPath(new URL('../../bin/dossier.js', import.meta.url));

function capture() {
  const out = { text: '', write(s) { this.text += s; return true; } };
  return out;
}

test('dossier init <dir> creates a workspace from the example', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const stdout = capture(); const stderr = capture();
    const target = join(dir, 'ws');
    const code = await main(['init', target], { stdout, stderr, env: {}, cwd: dir });
    assert.equal(code, 0, stderr.text);
    assert.match(stdout.text, /Created workspace/);
    assert.equal(loadWorkspace(target).config.defaultBrand, 'acme');
  } finally { cleanup(); }
});

test('dossier init without a dir uses DOSSIER_HOME / ./workspace', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const stdout = capture(); const stderr = capture();
    assert.equal(await main(['init'], { stdout, stderr, env: {}, cwd: dir }), 0, stderr.text);
    assert.ok(existsSync(join(dir, 'workspace', 'workspace.json')));
    assert.equal(await main(['init'], { stdout, stderr, env: { DOSSIER_HOME: 'other' }, cwd: dir }), 0, stderr.text);
    assert.ok(existsSync(join(dir, 'other', 'workspace.json')));
  } finally { cleanup(); }
});

test('dossier init refuses a non-empty directory with exit code 1', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(join(dir, 'busy'));
    writeFileSync(join(dir, 'busy', 'x.txt'), 'x');
    const stdout = capture(); const stderr = capture();
    assert.equal(await main(['init', join(dir, 'busy')], { stdout, stderr, env: {}, cwd: dir }), 1);
    assert.match(stderr.text, /not empty/);
  } finally { cleanup(); }
});

test('unknown commands print usage and exit 1; help exits 0', async () => {
  const stdout = capture(); const stderr = capture();
  assert.equal(await main(['frobnicate'], { stdout, stderr, env: {}, cwd: process.cwd() }), 1);
  assert.match(stderr.text, /Unknown command "frobnicate"/);
  assert.match(stderr.text, /init \[dir\]/);
  const out2 = capture();
  assert.equal(await main(['help'], { stdout: out2, stderr, env: {}, cwd: process.cwd() }), 0);
  assert.match(out2.text, /Usage: dossier <command>/);
});

test('bin/dossier.js runs as an executable', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const out = execFileSync(BIN, ['init', join(dir, 'ws')], { encoding: 'utf8' });
    assert.match(out, /Created workspace/);
    const res = spawnSync(BIN, ['init', join(dir, 'ws')], { encoding: 'utf8' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /not empty/);
  } finally { cleanup(); }
});
