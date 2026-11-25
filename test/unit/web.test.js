import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition, crossSiteReason, errorReply, hostAllowed, statusFor, wantsJson } from '../../src/web/http.js';
import { DossierError } from '../../src/errors.js';
import { uploadMeta } from '../../src/web/routes/upload.js';
import { searchOptions } from '../../src/web/routes/search.js';
import { isSpaRequest } from '../../src/web/spa.js';

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
  assert.deepEqual(errorReply(Object.assign(new Error('Forbidden'), { statusCode: 403 })), { status: 403, body: { code: 'FORBIDDEN', message: 'Forbidden', details: {} } });
  // The static plugin's refusal of a path it will not serve as spelled (it exists only under another spelling) is a 404.
  assert.deepEqual(errorReply(Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'FST_STATIC_FORBIDDEN_PATH' })),
    { status: 404, body: { code: 'NOT_FOUND', message: 'Not found', details: {} } });
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

test('searchOptions parses query strings', () => {
  assert.deepEqual(searchOptions({ q: 'inv', types: 'Invoice,Receipt', status: '', limit: '5', expand: '0' }),
    { q: 'inv', types: ['Invoice', 'Receipt'], limit: 5, expand: false });
});

test('wantsJson: any-case /api paths (with or without a slash) and Accept: application/json', () => {
  const req = (url, accept) => ({ url, headers: accept ? { accept } : {} });
  for (const url of ['/api', '/api/', '/api/me', '/API/me', '/API/x', '/Api?x=1', '//api/x', '//api', '/api;x', '///API;x']) assert.equal(wantsJson(req(url)), true, url);
  for (const url of ['/', '/apis', '/apidocs/x', '/dashboard?api=1']) assert.equal(wantsJson(req(url)), false, url);
  assert.equal(wantsJson(req('/dashboard', 'application/json')), true);
});

test('isSpaRequest: GET/HEAD client routes only; never /api, file namespaces or file names, decoded or not', () => {
  const req = (url, method = 'GET', accept = 'text/html') => ({ url, method, headers: { accept } });
  for (const url of ['/', '/dashboard', '/documents/DOC-000001', '/settings/brands/acme', '/search?q=x', '/vault/03%20Clients']) {
    assert.equal(isSpaRequest(req(url)), true, url);
  }
  assert.equal(isSpaRequest(req('/dashboard', 'HEAD')), true);
  assert.equal(isSpaRequest(req('/dashboard', 'POST')), false);
  assert.equal(isSpaRequest(req('/dashboard', 'GET', 'application/json')), false);
  for (const url of [
    '/api', '/API', '/api/nope', '/Api/x', '/API/x', '/%61pi/x', '/%41PI', '//api/x', '/api;x', '//%61pi;x', '//app/x.js', '/app;x',
    '/app', '/app/x.js', '/APP/x.js', '/%61pp/x.js', '/assets/x', '/blobs/x/y', '/previews/t/f', '/brand/x.png', '/static/app.css',
    '/documents/DOC-1/renditions/pdf', '/documents/DOC-1/%72enditions/pdf', '/favicon.ico', '/robots.txt', '/workspace%2Ejson',
    '/%E0%A4%A',
  ]) {
    assert.equal(isSpaRequest(req(url)), false, url);
  }
});
