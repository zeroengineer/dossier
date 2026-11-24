import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLE_WORKSPACE } from '../../src/paths.js';
import { loadWorkspace } from '../../src/workspace/index.js';
import { blocksToHtml, cssColour, cssValue, escapeHtml } from '../../src/render/html/index.js';
import { blocksToMarkdown } from '../../src/render/md/index.js';
import { BlockError, validateBlocks } from '../../src/render/blocks.js';
import { parseMarkdownBlocks } from '../../src/render/md/parse.js';
import { BLOCK_DOC } from '../fixtures/blockDoc.js';

const ws = loadWorkspace(EXAMPLE_WORKSPACE);
const brand = ws.brands.get('acme');
const SNAP = join(import.meta.dirname, '__snapshots__');

function snapshot(name, current) {
  const file = join(SNAP, name);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(file)) writeFileSync(file, current);
  assert.equal(current, readFileSync(file, 'utf8'));
}

test('HTML snapshot of a block document (served mode: font and image URLs)', () => {
  const html = blocksToHtml(BLOCK_DOC, { brand, ws, title: 'Sample <letter>', contact: 'hr' });
  snapshot('blocks.html', html);
  assert.equal(blocksToHtml(BLOCK_DOC, { brand, ws, title: 'Sample <letter>', contact: 'hr' }), html, 'deterministic');
});

test('HTML escapes every interpolated text', () => {
  const html = blocksToHtml(BLOCK_DOC, { brand, ws, title: 'Sample <letter>' });
  assert.match(html, /<title>Sample &lt;letter&gt;<\/title>/);
  assert.match(html, /<h2>1\. Scope &amp; &lt;duties&gt;<\/h2>/);
  assert.match(html, /these terms &lt;and&gt; agrees to be bound by them in full &amp; without/);
  assert.match(html, /<strong>terms of engagement<\/strong>/);
  assert.doesNotMatch(html, /<and>|<duties>/);
  const evil = blocksToHtml([{ type: 'table', columns: ['<b>'], rows: [['"><script>alert(1)</script>']] }], { brand: { ...brand, legalName: '<Evil & Co>' } });
  assert.doesNotMatch(evil, /<script>alert/);
  assert.match(evil, /&lt;Evil &amp; Co&gt;/);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('palette values and styleVars cannot break out of the stylesheet', () => {
  const evil = { ...brand, palette: { ...brand.palette, ink: 'red</style><script>alert(1)</script>', body: 'rgb(1, 2, 3)', rule: 'tomato' } };
  const html = blocksToHtml(BLOCK_DOC, { brand: evil, styleVars: { 'x;}</style>': '1px</style><script>', accent: 'blue; } body { x' } });
  assert.doesNotMatch(html, /<script>|<\/style><script/);
  assert.match(html, /--ink: inherit;/);
  assert.match(html, /--body: rgb\(1, 2, 3\);/);
  assert.match(html, /--rule: tomato;/);
  assert.match(html, /--xstyle: 1px\/stylescript;/);
  assert.match(html, /--accent: blue  body  x;/);
  const quoted = blocksToHtml([], { brand, styleVars: { accent: `"x' /* y */ z` } });
  assert.match(quoted, /--accent: x \/ y \/ z;/);
  assert.equal(cssColour('#1a1a1a'), '#1a1a1a');
  assert.equal(cssColour('hsla(10, 20%, 30%, 0.5)'), 'hsla(10, 20%, 30%, 0.5)');
  assert.equal(cssColour('url(x)'), 'inherit');
});

test('HTML uses pt metrics from the layout profile and block style', () => {
  const html = blocksToHtml(BLOCK_DOC, { brand, ws, profileId: 'letter', styleVars: { ink: '#000000', '--accent': '#123456' } });
  assert.match(html, /@page \{ size: A4; margin: 0; \}/);
  assert.match(html, /\.page \{[^}]*width: 595\.28pt; min-height: 841\.89pt;[^}]*padding: 110pt 37\.5pt 39pt 37\.5pt;/);
  assert.match(html, /\.doc h1 \{ font-size: 17pt; font-weight: 700; line-height: 25\.222pt;[^}]*text-transform: uppercase;/);
  assert.match(html, /\.doc p \{ font-size: 10\.5pt; line-height: 18\.843pt; text-align: justify;/);
  assert.match(html, /--ink: #000000;/);
  assert.match(html, /--accent: #123456;/);
});

test('standalone HTML embeds fonts (base64) and images (data URIs) and references no server assets', () => {
  const html = blocksToHtml(BLOCK_DOC, { brand, ws, standalone: true });
  assert.equal(html.match(/src: url\("data:font\/ttf;base64,/g).length, 5);
  assert.match(html, /<header class="letterhead"><img src="data:image\/png;base64,/);
  assert.match(html, /<div class="signature"><div class="for">FOR Acme Events Private Limited<\/div><img src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /\/assets\//);
});

test('Markdown snapshot of a block document', () => {
  const md = blocksToMarkdown(BLOCK_DOC, { brand, title: 'Sample letter' });
  snapshot('blocks.md', md);
  assert.match(md, /^# Sample letter\n\n# Terms of engagement\n/);
  assert.match(md, /\| Allowance \\\| other \| 2,000 \| 24,000 \|/);
  assert.equal(blocksToMarkdown([{ type: 'heading', level: 1, text: 'Same' }], { title: 'Same' }), '# Same\n');
});

test('Markdown round trip: parse(render(blocks)) keeps headings, paragraphs, lists and tables', () => {
  const simple = BLOCK_DOC.filter((b) => ['heading', 'paragraph', 'bullets', 'numbered', 'table', 'divider'].includes(b.type) && !b.align);
  const back = parseMarkdownBlocks(blocksToMarkdown(simple));
  assert.deepEqual(back.map((b) => b.type), simple.map((b) => b.type));
  assert.equal(back[2].text, simple[2].text);
  assert.equal(back[2].cover, true, 'blocks before the first divider come back as cover');
  assert.deepEqual(back[5].rows.at(-1), ['**Gross**', '**12,000**', '**1,44,000**']);
});

test('validateBlocks rejects malformed blocks with a path', () => {
  const bad = [
    [{ type: 'heading', level: 4, text: 'x' }, /blocks\[0\]: heading: level/],
    [{ type: 'paragraph' }, /text is required/],
    [{ type: 'bullets', items: [{}] }, /items must be a list of strings/],
    [{ type: 'table', columns: [], rows: [] }, /columns must be a non-empty list/],
    [{ type: 'keyValue', rows: [['a']] }, /\[key, value\] pairs/],
    [{ type: 'signature' }, /needs signatoryId or party/],
    [{ type: 'spacer', size: -1 }, /non-negative/],
    [{ type: 'custom' }, /name is required/],
    [{ type: 'video' }, /blocks\[0\]\.type: unknown block type "video"/],
    [{ type: 'paragraph', text: 'x', align: 'middle' }, /align must be one of/],
  ];
  for (const [block, re] of bad) assert.throws(() => validateBlocks([block]), (e) => e instanceof BlockError && re.test(e.message));
  assert.throws(() => validateBlocks({}), /must be an array/);
});

test('cssValue never lets a comment token form, whatever is stripped first', () => {
  for (const v of ['/"*x', '//**x', "a*'/b", '/*x*/', '*/}', '/<*', '/\\*x', "/'*'/", 'a/**/b', '/;*x']) {
    const out = cssValue(v);
    assert.doesNotMatch(out, /\/\*|\*\//, `${v} -> ${out}`);
    assert.doesNotMatch(out, /[<>{};\\"'*]/, `${v} -> ${out}`);
  }
  assert.equal(cssValue('12pt/1.5 Manrope'), '12pt/1.5 Manrope');
  assert.equal(cssValue(null), '');
});
