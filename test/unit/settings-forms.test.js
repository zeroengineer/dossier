import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyBrandSection, newBrandBody, parseRates, seriesFromForm, workspaceFromForm } from '../../src/web/settingsForms.js';
import { isSafeRelPath, parseAssetKey, writeFileAtomic } from '../../src/services/workspaceFiles.js';
import { loadWorkspace, WorkspaceError } from '../../src/workspace/index.js';
import { tmpDir } from '../helpers/tmp.js';
import { minimalBrand, writeWorkspace } from '../helpers/workspace.js';

test('parseRates reads fractions and percentages, flags the rest', () => {
  const errors = [];
  assert.deepEqual(parseRates('CGST (9%) = 9%\nIGST = 0.18\n\n', 'p', errors), [{ label: 'CGST (9%)', rate: 0.09 }, { label: 'IGST', rate: 0.18 }]);
  assert.deepEqual(errors, []);
  parseRates('GST', 'tax.modes.0.rates', errors);
  assert.equal(errors[0].path, 'tax.modes.0.rates');
});

test('a child brand section leaves inherited keys out', () => {
  const own = { id: 'child', inheritsFrom: 'acme', legalName: 'Child LLP', footer: { left: 'x' } };
  const { body } = applyBrandSection(own, 'letterhead', { 'letterhead.lines.0': 'A', 'footer.left': '', 'footer.right': 'R' }, { inherits: true });
  assert.deepEqual(body, { id: 'child', inheritsFrom: 'acme', legalName: 'Child LLP', footer: { right: 'R' } });
  const over = applyBrandSection(own, 'letterhead', { '$override.letterhead.lines': 'on', 'letterhead.lines.0': 'A' }, { inherits: true }).body;
  assert.deepEqual(over.letterhead, { lines: ['A'] });
  assert.equal(over.footer, undefined, 'blank footer slots inherit; the emptied object is removed');
});

test('new brand, series and workspace forms', () => {
  assert.deepEqual(newBrandBody({ id: 'kid', inheritsFrom: 'acme', legalName: 'Kid' }), { id: 'kid', inheritsFrom: 'acme', legalName: 'Kid' });
  assert.deepEqual(newBrandBody({ id: 'b', legalName: 'B', shortName: 'B', 'addresses.business': 'L1\nL2' }),
    { id: 'b', legalName: 'B', shortName: 'B', addresses: { business: ['L1', 'L2'] }, contacts: { default: {} } });
  const s = seriesFromForm([{ id: 'a', pattern: 'A-{##}', note: 'kept' }], { 'series.0.id': 'a', 'series.0.pattern': 'A-{###}', 'series.0.counter': 'a', 'series.1.id': '' });
  assert.deepEqual(s.body, [{ note: 'kept', id: 'a', pattern: 'A-{###}' }]);
  const w = workspaceFromForm({ name: 'X', defaultBrand: 'acme', hierarchy: { routing: {} } }, { name: 'Y', defaultBrand: 'acme', 'users.0.id': 'a b' });
  assert.equal(w.errors[0].path, 'users.0.id');
  assert.deepEqual(w.body.hierarchy, { routing: {} });
});

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
