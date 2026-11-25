import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeRelPath, parseAssetKey, writeFileAtomic } from '../../src/services/workspaceFiles.js';
import { loadWorkspace, WorkspaceError } from '../../src/workspace/index.js';
import { tmpDir } from '../helpers/tmp.js';
import { minimalBrand, writeWorkspace } from '../helpers/workspace.js';

test('asset keys and safe paths', () => {
  assert.deepEqual(parseAssetKey('assets.logo'), { kind: 'image', slot: 'logo' });
  assert.deepEqual(parseAssetKey('signature-large:md'), { kind: 'signature', slot: 'signature-large', arg: 'md' });
  assert.deepEqual(parseAssetKey('font:bold'), { kind: 'font', slot: 'font', arg: 'bold' });
  assert.throws(() => parseAssetKey('font:heavy'), /Unknown asset key/);
  for (const ok of ['assets/logo.png', 'assets/fonts/a.ttf', 'logo.png']) assert.ok(isSafeRelPath(ok), ok);
  for (const bad of ['../x.png', 'assets/../../x', '/etc/hosts', 'C:/x', 'a\\b', './x', 'assets//x', '']) assert.equal(isSafeRelPath(bad), false, bad);
});

test('loadWorkspace validates candidate files without touching the disk', () => {
  const t = tmpDir();
  try {
    writeWorkspace(t.dir, { series: [{ id: 'inv', pattern: 'I-{###}' }] });
    const ws = loadWorkspace(t.dir, { files: new Map([['brands/new/brand.json', minimalBrand('new', { legalName: 'New Example' })]]) });
    assert.equal(ws.brands.get('new').legalName, 'New Example');
    assert.throws(() => loadWorkspace(t.dir, { files: new Map([['series.json', [{ id: 'inv', pattern: 'I-{PREFIX}-{###}' }]]]) }),
      (e) => e instanceof WorkspaceError && e.file === 'series.json');
    assert.equal(loadWorkspace(join(t.dir)).brands.has('new'), false);
  } finally {
    t.cleanup();
  }
});

test('writeFileAtomic replaces a file and leaves no temp file when the rename fails', () => {
  const t = tmpDir();
  try {
    const f = join(t.dir, 'a.json');
    writeFileAtomic(f, 'one');
    writeFileAtomic(f, 'two');
    assert.equal(readFileSync(f, 'utf8'), 'two');
    mkdirSync(join(t.dir, 'busy', 'inner'), { recursive: true });
    assert.throws(() => writeFileAtomic(join(t.dir, 'busy'), 'x'));
    assert.deepEqual(readdirSync(t.dir).sort(), ['a.json', 'busy']);
  } finally {
    t.cleanup();
  }
});
