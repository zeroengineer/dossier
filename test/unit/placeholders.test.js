import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PLACEHOLDERS_DIR } from '../../src/paths.js';
import { PLACEHOLDERS, renderPlaceholder } from '../../scripts/make-placeholders.js';

sharp.cache(false);

const EXPECTED = {
  'logo.png': [1027, 234],
  'signature.png': [1024, 406],
  'signature-large.png': [5914, 4873],
  'seal.png': [1586, 1471],
};

test('placeholder list matches the expected files and sizes', () => {
  assert.deepEqual(Object.fromEntries(PLACEHOLDERS.map((p) => [p.file, [p.width, p.height]])), EXPECTED);
});

for (const [file, [width, height]] of Object.entries(EXPECTED)) {
  test(`${file} is ${width}x${height} RGBA with a transparent background`, async () => {
    const buf = readFileSync(join(PLACEHOLDERS_DIR, file));
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, width);
    assert.equal(meta.height, height);
    assert.equal(meta.hasAlpha, true);
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, 'top-left pixel is transparent');
    assert.equal(data[(info.width * info.height - 1) * 4 + 3], 0, 'bottom-right pixel is transparent');
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    assert.ok(opaque > 0, 'something is drawn');
  });
}

test('committed placeholders are exactly what the script generates (deterministic)', async () => {
  for (const p of PLACEHOLDERS) {
    if (p.file === 'signature-large.png') continue; // same drawing as signature.png at a larger size; checked for size above
    const a = await renderPlaceholder(p);
    const b = await renderPlaceholder(p);
    assert.ok(a.equals(b), `${p.file} renders identically twice`);
    assert.ok(a.equals(readFileSync(join(PLACEHOLDERS_DIR, p.file))), `${p.file} matches the committed file`);
  }
});

test('signature-large.png stays small on disk', () => {
  assert.ok(readFileSync(join(PLACEHOLDERS_DIR, 'signature-large.png')).length < 300 * 1024);
});
