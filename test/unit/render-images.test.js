import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { utimesSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { clearImageCache, loadImage } from '../../src/render/pdf/images.js';
import { PLACEHOLDERS_DIR } from '../../src/paths.js';
import { tmpDir } from '../helpers/tmp.js';

sharp.cache(false);

test('loadImage resizes by height or width and reports the prepared size', async () => {
  const logo = await loadImage(join(PLACEHOLDERS_DIR, 'logo.png'), { resizeHeight: 80 });
  assert.equal(logo.height, 80);
  assert.equal(logo.width, Math.round(1027 * 80 / 234));
  const seal = await loadImage(join(PLACEHOLDERS_DIR, 'seal.png'), { trim: true, resizeWidth: 600 });
  assert.equal(seal.width, 600);
  const raw = await loadImage(join(PLACEHOLDERS_DIR, 'signature.png'), { flattenWhite: true });
  assert.deepEqual([raw.width, raw.height], [1024, 406]);
  assert.equal((await sharp(raw.buffer).metadata()).channels, 3, 'flattened: no alpha');
});

test('loadImage caches by path, mtime and options, and output is reproducible', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const p = join(dir, 'a.png');
    writeFileSync(p, await sharp({ create: { width: 40, height: 20, channels: 4, background: '#ff000080' } }).png().toBuffer());
    const a = await loadImage(p, { resizeHeight: 10 });
    assert.equal(await loadImage(p, { resizeHeight: 10 }), a, 'same object from cache');
    assert.notEqual(await loadImage(p, { resizeHeight: 5 }), a);
    clearImageCache();
    const b = await loadImage(p, { resizeHeight: 10 });
    assert.notEqual(b, a);
    assert.ok(a.buffer.equals(b.buffer), 'identical bytes after a cache clear');
    writeFileSync(p, await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00ff00ff' } }).png().toBuffer());
    utimesSync(p, new Date(), new Date(Date.now() + 5000));
    const c = await loadImage(p, { resizeHeight: 10 });
    assert.equal(c.width, 10, 'file change is picked up');
  } finally {
    cleanup();
  }
});
