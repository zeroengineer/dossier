// scripts/samples.js (npm run samples) and the pure parts of scripts/visual.js (npm run visual).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { initWorkspace } from '../../src/workspace/index.js';
import { formatTable, generateSamples, MANIFEST, parseArgs, sampleTemplateIds } from '../../scripts/samples.js';
import { comparePng, MAX_DIFF_RATIO } from '../../scripts/visual.js';
import { tmpDir } from '../helpers/tmp.js';

test('every built-in template has a fixture and is a sample', () => {
  const builtins = readdirSync(join(import.meta.dirname, '..', '..', 'src', 'templates'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepEqual(sampleTemplateIds(), builtins);
  assert.equal(builtins.length, 17);
});

test('samples: two templates into a temp folder, reproducible, with a table and a manifest', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const out = join(dir, 'out');
    const results = await generateSamples({ out, templates: ['invoice', 'offer-letter'] });
    assert.deepEqual(results.map((r) => [r.template, r.ok, r.number, r.pages]), [
      ['invoice', true, 'ACM-2026-0001', 1],
      ['offer-letter', true, null, 7],
    ]);
    assert.deepEqual(readdirSync(out).sort(), ['invoice.html', 'invoice.md', 'invoice.pdf',
      'offer-letter.html', 'offer-letter.md', 'offer-letter.pdf', MANIFEST]);
    assert.match(readFileSync(join(out, 'invoice.md'), 'utf8'), /ACM-2026-0001/);
    const manifest = JSON.parse(readFileSync(join(out, MANIFEST), 'utf8'));
    assert.equal(manifest.exampleWorkspace, true);
    assert.equal(manifest.templates.length, 2);

    // Pinned dates: a second run gives byte-identical files and the same number (each template has its own database).
    const again = await generateSamples({ out: join(dir, 'again'), templates: ['invoice'] });
    assert.equal(again[0].sha256, results[0].sha256);
    assert.ok(readFileSync(join(out, 'invoice.pdf')).equals(readFileSync(join(dir, 'again', 'invoice.pdf'))));

    const table = formatTable(results).split('\n');
    assert.match(table[0], /^template\s+number\s+pages\s+pdf bytes\s+sha256/);
    assert.match(table[1], new RegExp(`^invoice\\s+ACM-2026-0001\\s+1\\s+${results[0].bytes}\\s+${results[0].sha256.slice(0, 12)}`));
    assert.match(table[2], /^offer-letter\s+-\s+7\s+/);
  } finally {
    cleanup();
  }
});

test('samples: a given workspace is only read (copied to a temp folder first)', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const home = initWorkspace(join(dir, 'ws'));
    const before = readdirSync(home).sort();
    const wsJson = readFileSync(join(home, 'workspace.json'), 'utf8');
    const [r] = await generateSamples({ home, out: join(dir, 'out'), templates: ['receipt'] });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(readdirSync(home).sort(), before);
    assert.equal(existsSync(join(home, 'data')), false);
    assert.equal(readFileSync(join(home, 'workspace.json'), 'utf8'), wsJson);
    assert.equal(JSON.parse(readFileSync(join(dir, 'out', MANIFEST), 'utf8')).exampleWorkspace, false);
  } finally {
    cleanup();
  }
});

test('samples: a workspace.json that is a symbolic link is never written through', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const home = initWorkspace(join(dir, 'ws'));
    const real = join(dir, 'elsewhere-workspace.json');
    renameSync(join(home, 'workspace.json'), real);
    symlinkSync(real, join(home, 'workspace.json'));
    const before = readFileSync(real, 'utf8');
    const [r] = await generateSamples({ home, out: join(dir, 'out'), templates: ['invoice'] });
    assert.equal(r.ok, true, r.error);
    assert.equal(readFileSync(real, 'utf8'), before);
    assert.ok(lstatSync(join(home, 'workspace.json')).isSymbolicLink());
    assert.equal(existsSync(join(home, 'data')), false);
  } finally {
    cleanup();
  }
});

test('samples: options and unknown templates', async () => {
  assert.deepEqual(parseArgs(['--template', 'invoice', '--template', 'mou']).templates, ['invoice', 'mou']);
  assert.throws(() => parseArgs(['--out']), /--out needs a value/);
  assert.throws(() => parseArgs(['--bogus']), /unknown option --bogus/);
  await assert.rejects(generateSamples({ templates: ['nope'] }), /unknown template "nope"/);
});

function png(width, height, paint) {
  const p = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = paint(i % width, Math.floor(i / width));
    p.data.set([r, g, b, 255], i * 4);
  }
  return PNG.sync.write(p);
}

test('visual: comparePng passes identical pages and fails changed or resized ones', () => {
  const white = () => [255, 255, 255];
  const base = png(100, 100, white);
  assert.deepEqual(comparePng(base, base), { ok: true, diffPixels: 0, ratio: 0 });
  // One pixel in 10 000 is within the allowance (0.1 %); a 20 x 20 black square is not.
  assert.ok(MAX_DIFF_RATIO >= 1 / 10000);
  assert.equal(comparePng(png(100, 100, (x, y) => (x === 5 && y === 5 ? [0, 0, 0] : [255, 255, 255])), base).ok, true);
  const changed = comparePng(png(100, 100, (x, y) => (x < 20 && y < 20 ? [0, 0, 0] : [255, 255, 255])), base);
  assert.equal(changed.ok, false);
  assert.equal(changed.diffPixels, 400);
  assert.ok(Buffer.isBuffer(changed.diff));
  assert.match(comparePng(png(100, 90, white), base).reason, /size 100x90, baseline 100x100/);
});
