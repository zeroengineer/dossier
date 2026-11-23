import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, htmlToText } from '../../src/extract/index.js';
import { makePdf } from '../helpers/pdf.js';

test('extracts text and page count from a pdfkit PDF', async () => {
  const buf = await makePdf(['Invoice for Acme Events', 'Second page total 1200']);
  const out = await extractText(buf, { mime: 'application/pdf', filename: 'inv.pdf' });
  assert.equal(out.pageCount, 2);
  assert.match(out.text, /Invoice for Acme Events/);
  assert.match(out.text, /Second page total 1200/);
  assert.ok(out.text.indexOf('Invoice') < out.text.indexOf('Second'));
});

test('PDF detected by extension when the mime is generic', async () => {
  const buf = await makePdf(['Hello by extension']);
  const out = await extractText(buf, { mime: 'application/octet-stream', filename: 'X.PDF' });
  assert.match(out.text, /Hello by extension/);
});

test('broken or non-PDF bytes give empty text, never throw', async () => {
  assert.deepEqual(await extractText(Buffer.from('%PDF-1.7 not really'), { mime: 'application/pdf', filename: 'a.pdf' }), { text: '' });
  assert.deepEqual(await extractText(Buffer.alloc(0), { mime: 'application/pdf', filename: 'a.pdf' }), { text: '' });
});

test('password-protected PDFs give empty text', async () => {
  const buf = await makePdf(['Locked content'], { userPassword: 'secret-pass', pdfVersion: '1.7' });
  assert.deepEqual(await extractText(buf, { mime: 'application/pdf', filename: 'locked.pdf' }), { text: '' });
});

test('HTML: strips tags, scripts, styles and comments; decodes entities', async () => {
  const html = '<!doctype html><html><head><title>T</title><style>p{color:red}</style><script>var x = "<b>no</b>";</script></head>'
    + '<body><h1>Quote &amp; Terms</h1><!-- hidden --><p>Price&nbsp;&#8377;1,000 &lt;net&gt; &#x41;&quot;</p><p>Next<br>line</p></body></html>';
  const out = await extractText(Buffer.from(html), { mime: 'text/html', filename: 'q.html' });
  assert.doesNotMatch(out.text, /color|var x|hidden|<\/|<(?:p|h1|br|body|html)\b/);
  assert.match(out.text, /Quote & Terms/);
  assert.match(out.text, /Price ₹1,000 <net> A"/);
  assert.match(out.text, /Next\nline/);
  assert.equal(out.pageCount, undefined);
});

test('htmlToText keeps unknown entities and collapses blank lines', () => {
  assert.equal(htmlToText('<p>a &bogus; b</p>\n\n\n<div>c</div>'), 'a &bogus; b\n\nc');
});

test('Markdown and plain text are returned as is (BOM removed)', async () => {
  const md = '# Title\n\n- item *one*\n';
  assert.deepEqual(await extractText(Buffer.from(md), { mime: 'text/markdown', filename: 'n.md' }), { text: md });
  assert.deepEqual(await extractText(Buffer.from('﻿plain'), { filename: 'n.txt' }), { text: 'plain' });
});

test('unknown types give empty text', async () => {
  assert.deepEqual(await extractText(Buffer.from([1, 2, 3]), { mime: 'image/png', filename: 'x.png' }), { text: '' });
  assert.deepEqual(await extractText(Buffer.from('zz'), {}), { text: '' });
});
