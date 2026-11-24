import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, escapeHtml, qs } from '../../src/web/html.js';
import { contentDisposition, crossSiteReason, errorReply, hostAllowed, nestForm, parseUrlEncoded, statusFor } from '../../src/web/http.js';
import { DossierError } from '../../src/errors.js';
import { formToInput } from '../../src/web/routes/templates.js';
import { uploadMeta } from '../../src/web/routes/upload.js';
import { searchOptions } from '../../src/web/routes/search.js';
import { entityInput } from '../../src/web/routes/entities.js';
import { snippet } from '../../src/web/views/search.js';

test('html escapes every interpolation; raw() and nested html are kept; arrays join; nullish prints nothing', () => {
  const evil = '<img src=x onerror="alert(1)">&\'`';
  assert.equal(String(html`<p title="${evil}">${evil}</p>`),
    '<p title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&#96;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&#96;</p>');
  assert.equal(String(html`<b>${raw('<i>ok</i>')}</b>`), '<b><i>ok</i></b>');
  assert.equal(String(html`<ul>${['a', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}${0}`), '0');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(qs({ a: 1, b: '', c: null, d: 'x y' }), '?a=1&d=x+y');
  assert.equal(qs({}), '');
});

test('search snippets highlight [matches] and escape the rest', () => {
  assert.equal(String(html`${snippet('pay <b>[invoice]</b> now')}`), 'pay &lt;b&gt;<mark>invoice</mark>&lt;/b&gt; now');
});

test('error codes map to HTTP statuses', () => {
  const cases = {
    DOCUMENT_NOT_FOUND: 404, ENTITY_NOT_FOUND: 404, TEMPLATE_NOT_FOUND: 404, NODE_NOT_FOUND: 404, BLOB_NOT_FOUND: 404,
    VERSION_NOT_FOUND: 404, RENDITION_NOT_FOUND: 404, BRAND_NOT_FOUND: 404,
    FORBIDDEN: 403,
    ENTITY_DUPLICATE: 409, NUMBER_CONFLICT: 409, CONFLICT: 409, STATUS_LOCKED: 409, INVALID_STATUS_TRANSITION: 409, NUMBER_CONTENDED: 409,
    INVALID_INPUT: 400, FIELDS_MISSING: 400, FIELDS_INVALID: 400, SECRET_REJECTED: 400, ENTITY_AMBIGUOUS: 400,
    SERIES_UNKNOWN: 400, NUMBER_VAR_MISSING: 400,
    TEMPLATE_RENDER_FAILED: 422,
    TEMPLATE_INVALID: 500,
  };
  for (const [code, status] of Object.entries(cases)) assert.equal(statusFor(code), status, code);
  assert.deepEqual(errorReply(new DossierError('FORBIDDEN', 'no', { id: 'DOC-000001' })),
    { status: 403, body: { code: 'FORBIDDEN', message: 'no', details: { id: 'DOC-000001' } } });
  assert.deepEqual(errorReply(new Error('secret internals')).body, { code: 'INTERNAL', message: 'Internal server error', details: {} });
  assert.equal(errorReply(Object.assign(new Error('too big'), { statusCode: 413 })).body.code, 'PAYLOAD_TOO_LARGE');
});

test('nestForm builds objects and arrays from dotted names and ignores prototype keys', () => {
  assert.deepEqual(nestForm({ 'billTo.name': 'A', 'items.0.amount': '1', 'items.2.amount': '3', x: 'y' }),
    { billTo: { name: 'A' }, items: [{ amount: '1' }, { amount: '3' }], x: 'y' });
  const out = nestForm({ '__proto__.polluted': '1', 'a.constructor.prototype.p': '1', 'a..b': '1' });
  assert.deepEqual(out, {});
  assert.equal({}.polluted, undefined);
  assert.deepEqual(parseUrlEncoded('a=1&b=x+y&a=2'), { a: '2', b: 'x y' });
});

test('crossSiteReason: same origin only for form posts; JSON, other methods and X-Dossier-Client pass without Origin', () => {
  const req = (method, headers) => ({ method, headers: { host: 'localhost:4400', ...headers } });
  assert.equal(crossSiteReason(req('GET', { origin: 'http://evil.example' })), null);
  assert.equal(crossSiteReason(req('POST', { origin: 'http://localhost:4400' })), null);
  assert.match(crossSiteReason(req('POST', { origin: 'http://evil.example' })), /does not match/);
  assert.match(crossSiteReason(req('POST', { origin: 'http://localhost:4401' })), /does not match/);
  assert.match(crossSiteReason(req('POST', { origin: 'null' })), /null/);
  assert.equal(crossSiteReason(req('POST', { referer: 'http://localhost:4400/upload' })), null);
  assert.match(crossSiteReason(req('POST', { 'content-type': 'application/x-www-form-urlencoded' })), /Origin or Referer/);
  assert.match(crossSiteReason(req('POST', { 'content-type': 'text/plain' })), /Origin or Referer/);
  assert.equal(crossSiteReason(req('POST', { 'content-type': 'application/json; charset=utf-8' })), null);
  assert.equal(crossSiteReason(req('POST', { 'content-type': 'multipart/form-data; boundary=x', 'x-dossier-client': 'cli' })), null);
  assert.equal(crossSiteReason(req('DELETE', {})), null);
  assert.equal(crossSiteReason({ method: 'POST', headers: { host: 'localhost', origin: 'http://localhost:80' } }), null);
});

test('hostAllowed accepts loopback names only when restricted', () => {
  const loop = ['localhost', '127.0.0.1', '[::1]'];
  assert.equal(hostAllowed('localhost:4400', loop), true);
  assert.equal(hostAllowed('127.0.0.1', loop), true);
  assert.equal(hostAllowed('[::1]:4400', loop), true);
  assert.equal(hostAllowed('evil.example', loop), false);
  assert.equal(hostAllowed('evil.example', null), true);
});

test('contentDisposition keeps an ASCII fallback and the UTF-8 name', () => {
  assert.equal(contentDisposition('inline', 'a "b".pdf'), 'inline; filename="a _b_.pdf"; filename*=UTF-8\'\'a%20%22b%22.pdf');
  assert.match(contentDisposition('attachment', 'Café.pdf'), /filename="Caf_\.pdf"; filename\*=UTF-8''Caf%C3%A9\.pdf/);
});

test('formToInput drops blank rows, reads lists by line or JSON and reports bad JSON', () => {
  const fields = [
    { name: 'items', type: 'array', item: { description: 'text', amount: 'money' } },
    { name: 'documents', type: 'array', item: null },
    { name: 'clauses', type: 'array', item: null },
    { name: 'extra', type: 'object', item: null },
    { name: 'notes', type: 'array', item: null },
    { name: 'title', type: 'string', item: null },
  ];
  const { input, errors } = formToInput(fields, {
    'items.0.description': 'A', 'items.0.amount': '1', 'items.1.description': '', 'items.1.amount': ' ',
    documents: 'PAN card\n\n Passport \n', clauses: '[{"title":"T"}]', extra: '{bad', notes: '', title: '',
  });
  assert.deepEqual(input, { items: [{ description: 'A', amount: '1' }], documents: ['PAN card', 'Passport'], clauses: [{ title: 'T' }], extra: '{bad', title: '' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, 'extra');
  assert.deepEqual(formToInput(fields, { 'items.0.description': '' }).input, {});
});

test('uploadMeta: new document fields, version fields, amount in minor units, meta JSON', () => {
  assert.deepEqual(uploadMeta({ type: 'Invoice', title: ' T ', partyId: '3', amount: '1,000.5', currency: '', note: 'x' }, { defaultCurrency: 'INR' }),
    { type: 'Invoice', title: 'T', partyId: 3, amountMinor: 100050, currency: 'INR' });
  assert.deepEqual(uploadMeta({ documentId: 'DOC-000001', note: 'n', makeCurrent: 'true', type: 'ignored' }),
    { documentId: 'DOC-000001', note: 'n', makeCurrent: true });
  assert.deepEqual(uploadMeta({ meta: '{"type":"Letter","sensitivity":"Public"}' }), { type: 'Letter', sensitivity: 'Public' });
  assert.throws(() => uploadMeta({ amount: 'lots' }), (e) => e.code === 'INVALID_INPUT');
  assert.throws(() => uploadMeta({ meta: '[1]' }), (e) => e.code === 'INVALID_INPUT');
  assert.throws(() => uploadMeta({ partyId: 'x' }), (e) => e.code === 'INVALID_INPUT');
});

test('searchOptions and entityInput parse query strings and forms', () => {
  assert.deepEqual(searchOptions({ q: 'inv', types: 'Invoice,Receipt', status: '', limit: '5', expand: '0' }),
    { q: 'inv', types: ['Invoice', 'Receipt'], limit: 5, expand: false });
  assert.deepEqual(entityInput({ kind: 'client', name: ' X ', aliases: 'a, b,', attrs: '{"code":"X"}', brand: '' }),
    { name: 'X', kind: 'client', aliases: ['a', 'b'], attrs: { code: 'X' } });
  assert.deepEqual(entityInput({ name: 'X', brand: '' }, { editing: true }), { name: 'X', brand: null });
  assert.throws(() => entityInput({ name: 'X', attrs: '[]' }), (e) => e.code === 'INVALID_INPUT');
});
