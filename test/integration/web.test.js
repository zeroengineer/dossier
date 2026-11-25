import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { FAKE_INDEX, fakeSpaDir } from '../helpers/spa.js';
import { makePdf } from '../helpers/pdf.js';
import { fixtureInput } from '../helpers/templateRender.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { seedEntities } from '../../src/services/entities.js';
import { createDocument, addVersion } from '../../src/services/documents.js';
import { buildServer, SPA_CSP } from '../../src/server.js';

const ORIGIN = 'http://localhost:80';
let tmp; let ctx; let app; let internCtx; let internApp; let bare;
let pdfBytes; let secret; // a Confidential document the Internal user may not read

/** urlencoded form post from this site (what the removed server-rendered pages sent). */
const post = (url, fields, headers = {}) => app.inject({
  method: 'POST', url, headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...headers },
  payload: new URLSearchParams(fields).toString(),
});
/** JSON API call. */
const api = (method, url, body, server = app) => server.inject({ method, url, ...(body !== undefined ? { payload: body } : {}) });

/** A multipart body with one file and text fields. */
function multipart(fields, file) {
  const boundary = '----dossiertest';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
    parts.push(file.buffer, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

before(async () => {
  tmp = tmpDir();
  const home = join(tmp.dir, 'ws');
  initWorkspace(home);
  const wsFile = join(home, 'workspace.json');
  const ws = JSON.parse(readFileSync(wsFile, 'utf8'));
  ws.users = { ...ws.users, intern: { clearance: 'Internal' } };
  writeFileSync(wsFile, JSON.stringify(ws, null, 2));
  // A workspace MoU body with placeholders that print empty, to see PLACEHOLDER_EMPTY warnings end to end.
  mkdirSync(join(home, 'templates', 'mou'), { recursive: true });
  writeFileSync(join(home, 'templates', 'mou', 'body.md'), '# MoU\n\nWith {{partnerName}} at {{partnerOffice}}.\n');

  ctx = openContext({ home, user: 'demo', env: {} });
  seedEntities(ctx);
  internCtx = openContext({ home, user: 'intern', env: {} });
  const spaDir = fakeSpaDir(tmp.dir);
  app = buildServer(ctx, { spaDir });
  internApp = buildServer(internCtx, { spaDir });
  bare = buildServer(ctx, { spaDir: join(tmp.dir, 'no-dist') }); // the web app not built

  pdfBytes = await makePdf(['Confidential board minutes about the sample merger']);
  secret = createDocument(ctx, { type: 'Board Resolution', title: 'Secret minutes', sensitivity: 'Confidential' });
  addVersion(ctx, secret.id, { renditions: [{ kind: 'pdf', buffer: pdfBytes, filename: 'minutes.pdf', mime: 'application/pdf' }] });
});

after(async () => {
  await app?.close();
  await internApp?.close();
  await bare?.close();
  ctx?.close();
  internCtx?.close();
  tmp?.cleanup();
});

describe('web app', () => {
  test('/ and every client route answer the web app with SPA_CSP; HTML is never stored', async () => {
    for (const url of ['/', '/?node=01', '/dashboard', `/documents/${'DOC-000001'}`, '/documents/DOC-999999', '/search?q=minutes',
      '/upload', '/generate', '/generate/invoice', '/templates', '/entities', '/entities/1', '/settings', '/settings/brands/acme',
      '/settings/numbering', '/vault/01%20Company']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 200, url);
      assert.match(r.headers['content-type'], /^text\/html/, url);
      assert.equal(r.body, FAKE_INDEX, url);
      assert.equal(r.headers['content-security-policy'], SPA_CSP, url);
      assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN', url);
      assert.equal(r.headers['cache-control'], 'no-store', url);
    }
  });

  test('unknown /api paths, in any letter case and without a slash, answer JSON 404', async () => {
    for (const url of ['/api/nope', '/api', '/api/', '/API/me', '/API/x', '/Api/tree', '/%61pi/nope', '//api/x', '//api', '/api;x', '///API;x/y']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 404, url);
      assert.match(r.headers['content-type'], /^application\/json/, url);
      assert.equal(r.json().code, 'NOT_FOUND', url);
    }
  });

  test('the removed server-rendered UI: form posts and old files are JSON 404s', async () => {
    for (const url of [
      '/documents/DOC-000001/status', '/documents/DOC-000001/metadata', '/documents/DOC-000001/links', '/documents/DOC-000001/links/delete',
      '/entities', '/entities/1', '/entities/1/relations', '/generate/invoice', '/generate/invoice/preview', '/upload',
      '/settings/brands', '/settings/brands/acme', '/settings/brands/acme/assets', '/settings/series', '/settings/workspace',
    ]) {
      const r = await post(url, { title: 'x' });
      assert.equal(r.statusCode, 404, url);
      assert.equal(r.json().code, 'NOT_FOUND', url);
    }
    for (const url of ['/settings/brands/acme/brand.json', '/settings/brands/acme/preview.pdf', '/static/app.css', '/static/app.js', '/static/']) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 404, url);
      assert.equal(r.json().code, 'NOT_FOUND', url);
    }
  });

  test('errors are always JSON, even for a browser asking for HTML', async () => {
    const r = await app.inject({ url: '/api/documents/DOC-999999', headers: { accept: 'text/html' } });
    assert.equal(r.statusCode, 404);
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.equal(r.json().code, 'DOCUMENT_NOT_FOUND');
    const blob = await app.inject({ url: `/blobs/${'0'.repeat(64)}/x.pdf`, headers: { accept: 'text/html' } });
    assert.equal(blob.statusCode, 404);
    assert.match(blob.headers['content-type'], /^application\/json/);
  });

  test('a missing build answers client routes with 503 and the API as usual', async () => {
    const r = await bare.inject({ url: '/' });
    assert.equal(r.statusCode, 503);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.match(r.body, /npm run build/);
    assert.equal(r.headers['content-security-policy'], SPA_CSP);
    assert.equal((await bare.inject({ url: '/api/tree' })).statusCode, 200);
    assert.equal((await bare.inject({ url: '/api/nope' })).json().code, 'NOT_FOUND');
  });
});

describe('JSON API', () => {
  test('GET /api/tree and /api/documents/:id', async () => {
    const tree = await api('GET', '/api/tree');
    assert.equal(tree.statusCode, 200);
    assert.equal(tree.json().id, '');
    assert.ok(Array.isArray(tree.json().children));
    const doc = await api('GET', `/api/documents/${secret.id}`);
    assert.equal(doc.statusCode, 200);
    assert.equal(doc.json().title, 'Secret minutes');
    assert.equal(doc.json().renditions[0].kind, 'pdf');
    const list = await api('GET', '/api/documents?limit=5');
    assert.ok(list.json().documents.some((d) => d.id === secret.id));
  });

  test('POST status, metadata and links; DELETE links', async () => {
    const a = createDocument(ctx, { type: 'Quotation', title: 'Quote A' });
    const b = createDocument(ctx, { type: 'Invoice', title: 'Invoice B' });
    const st = await api('POST', `/api/documents/${a.id}/status`, { status: 'Sent' });
    assert.equal(st.statusCode, 200);
    assert.equal(st.json().status, 'Sent');
    const back = await api('POST', `/api/documents/${a.id}/status`, { status: 'Draft' });
    assert.equal(back.statusCode, 409);
    assert.equal(back.json().code, 'INVALID_STATUS_TRANSITION');
    const unknown = await api('POST', `/api/documents/${b.id}/status`, { status: 'Nonsense' });
    assert.equal(unknown.statusCode, 400, unknown.body);
    assert.equal((await api('GET', `/api/documents/${b.id}`)).json().status, 'Draft');
    const md = await api('POST', `/api/documents/${a.id}/metadata`, { title: 'Quote A (rev)' });
    assert.equal(md.json().title, 'Quote A (rev)');
    const link = await api('POST', `/api/documents/${b.id}/links`, { toId: a.id, type: 'based_on' });
    assert.equal(link.statusCode, 201);
    assert.equal(link.json().type, 'based_on');
    const seen = await api('GET', `/api/documents/${a.id}`);
    assert.ok(seen.json().relations.some((r) => r.direction === 'in' && r.document.id === b.id));
    const del = await api('DELETE', `/api/documents/${b.id}/links?toId=${a.id}&type=based_on`);
    assert.deepEqual(del.json(), { removed: true });
  });

  test('GET /api/search', async () => {
    const r = await api('GET', '/api/search?q=minutes');
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().hits[0].document.id, secret.id);
    const bad = await api('GET', '/api/search?q=x&limit=0');
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'INVALID_INPUT');
  });

  test('GET/POST /api/entities and relations', async () => {
    const found = await api('GET', '/api/entities?q=demo&kind=client');
    assert.equal(found.json().entities[0].name, 'Demo Retail LLP');
    assert.equal(typeof found.json().entities[0].documentCount, 'number', 'list rows carry a document count');
    const created = await api('POST', '/api/entities', { kind: 'vendor', name: 'Sample Catering Co', aliases: ['SCC'] });
    assert.equal(created.statusCode, 201);
    const dup = await api('POST', '/api/entities', { kind: 'vendor', name: 'Another', aliases: ['SCC'] });
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().code, 'ENTITY_DUPLICATE');
    const one = await api('GET', `/api/entities/${created.json().id}`);
    assert.deepEqual(one.json().aliases, ['SCC']);
    const rel = await api('POST', `/api/entities/${created.json().id}/relations`, { to: 'Acme Events Private Limited', role: 'vendor_of' });
    assert.equal(rel.statusCode, 201);
    const missing = await api('GET', '/api/entities/999999');
    assert.equal(missing.statusCode, 404);
  });

  test('POST /api/entities with an id edits; brand null clears the brand; bad attrs are a 400', async () => {
    const c = await api('POST', '/api/entities', { kind: 'client', name: 'Edit Client Ltd', brand: 'acme', attrs: { code: 'ECL' } });
    assert.equal(c.statusCode, 201, c.body);
    assert.equal(c.json().brand, 'acme');
    const { id } = c.json();
    const e = await api('POST', '/api/entities', { id, name: 'Edit Client Limited', aliases: ['ECL'] });
    assert.equal(e.statusCode, 200, e.body);
    assert.equal(e.json().id, id);
    assert.equal(e.json().name, 'Edit Client Limited');
    assert.ok(e.json().aliases.includes('ECL'), 'aliases are added');
    assert.equal(e.json().brand, 'acme', 'a brand left out is kept');
    const cleared = await api('POST', '/api/entities', { id, name: 'Edit Client Limited', brand: null });
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.equal(cleared.json().brand, null);
    assert.equal((await api('GET', `/api/entities/${id}`)).json().brand, null);
    for (const attrs of ['{nope', [], 7]) {
      const bad = await api('POST', '/api/entities', { id, name: 'Edit Client Limited', attrs });
      assert.equal(bad.statusCode, 400, `${JSON.stringify(attrs)}: ${bad.body}`);
      assert.equal(bad.json().code, 'INVALID_INPUT');
    }
    assert.deepEqual((await api('GET', `/api/entities/${id}`)).json().attrs, { code: 'ECL' });
  });

  test('GET /api/templates and /api/templates/:id; POST resolve', async () => {
    const list = await api('GET', '/api/templates');
    assert.ok(list.json().templates.some((t) => t.id === 'invoice' && t.category === 'invoice'));
    assert.deepEqual(list.json().errors, []);
    const one = await api('GET', '/api/templates/invoice');
    assert.equal(one.json().id, 'invoice');
    const items = one.json().fields.find((f) => f.name === 'items');
    assert.deepEqual(items.item, { description: 'text', hsn: 'string', amount: 'money' });
    assert.ok(one.json().fields.find((f) => f.name === 'taxMode').choices.length > 0);
    const res = await api('POST', '/api/templates/invoice/resolve', { input: { client: 'Demo Retail LLP' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().missing.map((m) => m.name), ['items']);
    const none = await api('GET', '/api/templates/nope');
    assert.equal(none.statusCode, 404);
    assert.equal(none.json().code, 'TEMPLATE_NOT_FOUND');
  });

  test('POST /api/templates/:id/preview and generate carry warnings; missing fields are 400', async () => {
    const pv = await api('POST', '/api/templates/mou/preview', { input: fixtureInput('mou') });
    assert.equal(pv.statusCode, 200, pv.body);
    assert.equal(pv.json().ok, true);
    assert.deepEqual(pv.json().warnings.map((w) => [w.code, w.name]), [['PLACEHOLDER_EMPTY', 'partnerOffice']]);
    const pdf = pv.json().renditions.find((r) => r.kind === 'pdf');
    assert.match(pdf.url, /^\/previews\/[0-9a-f]{64}\/preview\.pdf$/);
    assert.equal((await app.inject({ url: pdf.url })).headers['content-type'], 'application/pdf');
    assert.equal(pv.json().renditions[0].path, undefined, 'server paths are not exposed');

    const gen = await api('POST', '/api/templates/mou/generate', { input: fixtureInput('mou') });
    assert.equal(gen.statusCode, 201, gen.body);
    assert.match(gen.json().number, /^ACM-DOC-2026-\d{4}$/);
    assert.deepEqual(gen.json().warnings.map((w) => w.name), ['partnerOffice']);

    const short = await api('POST', '/api/templates/invoice/preview', { input: {} });
    assert.equal(short.statusCode, 400);
    assert.equal(short.json().ok, false);
    const fail = await api('POST', '/api/templates/invoice/generate', { input: { client: 'Demo Retail LLP' } });
    assert.equal(fail.statusCode, 400);
    assert.equal(fail.json().code, 'FIELDS_MISSING');
  });

  test('a negative salary on an offer letter is a 400 naming the row, not a 500', async () => {
    const input = { ...fixtureInput('offer-letter'), earnings: [{ label: 'Basic Salary', monthly: '-10,000' }] };
    for (const step of ['preview', 'generate']) {
      const r = await api('POST', `/api/templates/offer-letter/${step}`, { input });
      assert.equal(r.statusCode, 400, r.body);
      const body = r.json();
      const messages = step === 'preview' ? body.errors.map((e) => e.message).join(' ') : body.message;
      assert.match(messages, /earnings\.0: salary amounts must not be negative/);
      if (step === 'generate') assert.equal(body.code, 'FIELDS_INVALID');
    }
  });

  test('an impossible date on the metadata API is a 400', async () => {
    const d = createDocument(ctx, { type: 'Letter', title: 'Date check' });
    for (const bad of ['2026-13-45', '2026-02-30']) {
      const r = await api('POST', `/api/documents/${d.id}/metadata`, { docDate: bad });
      assert.equal(r.statusCode, 400, r.body);
      assert.equal(r.json().code, 'INVALID_INPUT');
      assert.match(r.json().message, /docDate must be a date YYYY-MM-DD/);
    }
  });
});

describe('upload', () => {
  test('POST /api/upload stores a file, a second identical upload is deduped', async () => {
    const buffer = await makePdf(['Rental agreement for the sample warehouse']);
    const body = multipart({ type: 'Agreement', title: 'Warehouse rent', docDate: '2026-04-01', amount: '12,000.50' }, { filename: 'rent.pdf', mime: 'application/pdf', buffer });
    const r = await app.inject({ method: 'POST', url: '/api/upload', ...body, headers: { ...body.headers, 'x-dossier-client': 'test' } });
    assert.equal(r.statusCode, 201, r.body);
    const doc = r.json().document;
    assert.equal(doc.title, 'Warehouse rent');
    assert.equal(doc.amountMinor, 1200050);
    assert.equal(doc.currency, 'INR');
    assert.deepEqual(doc.renditions.map((x) => x.kind).sort(), ['original', 'pdf']);
    const again = multipart({ documentId: doc.id, note: 'same bytes' }, { filename: 'rent.pdf', mime: 'application/pdf', buffer });
    const r2 = await app.inject({ method: 'POST', url: '/api/upload', ...again, headers: { ...again.headers, origin: ORIGIN } });
    assert.equal(r2.statusCode, 201);
    assert.equal(r2.json().deduped, true);
    assert.equal(r2.json().version.versionNo, 2);
    const s = await api('GET', '/api/search?q=warehouse');
    assert.ok(s.json().hits.some((h) => h.document.id === doc.id));
  });

  test('POST /api/upload refuses a secret with SECRET_REJECTED (400) and stores nothing', async () => {
    const before = (await api('GET', '/api/documents?limit=1')).json().total;
    const bad = multipart({ type: 'Letter' }, { filename: 'server.pem', mime: 'text/plain', buffer: Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n') });
    const r = await app.inject({ method: 'POST', url: '/api/upload', ...bad, headers: { ...bad.headers, origin: ORIGIN } });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().code, 'SECRET_REJECTED');
    assert.equal((await api('GET', '/api/documents?limit=1')).json().total, before);
  });
});

describe('generate through the API', () => {
  test('generate an invoice, read its renditions, then regenerate a locked document only with force', async () => {
    const input = {
      client: 'Example Institute of Sample Studies', date: '2026-07-14',
      items: [{ description: 'Platform services', amount: '12,500.00' }],
    };
    const gen = await api('POST', '/api/templates/invoice/generate', { input, brandId: 'acme' });
    assert.equal(gen.statusCode, 201, gen.body);
    const id = gen.json().documentId;
    assert.match(gen.json().number, /^ACM-2026-\d{4}$/);
    const pdf = await app.inject({ url: `/documents/${id}/renditions/pdf` });
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.rawPayload.subarray(0, 4).toString(), '%PDF');
    const html = await app.inject({ url: `/documents/${id}/renditions/html?version=1&download=1` });
    assert.equal(html.headers['content-security-policy'], 'sandbox');
    assert.match(html.headers['content-disposition'], /^attachment;/);

    assert.equal((await api('POST', `/api/documents/${id}/status`, { status: 'Sent' })).statusCode, 200);
    const locked = await api('POST', '/api/templates/invoice/generate', { input, documentId: id });
    assert.equal(locked.statusCode, 409);
    assert.equal(locked.json().code, 'STATUS_LOCKED');
    const forced = await api('POST', '/api/templates/invoice/generate', { input, documentId: id, force: true, note: 'fixed amount' });
    assert.equal(forced.statusCode, 201, forced.body);
    const doc = (await api('GET', `/api/documents/${id}`)).json();
    assert.equal(doc.currentVersion, 2);
    assert.equal(doc.status, 'Draft');
  });
});

describe('access control', () => {
  test('GET /api/documents?entityId= lists documents referencing the entity, without those above the clearance', async () => {
    const vendor = (await api('POST', '/api/entities', { kind: 'vendor', name: 'Example Stage Rentals' })).json();
    const other = (await api('POST', '/api/entities', { kind: 'vendor', name: 'Example Sound Hire' })).json();
    const asParty = createDocument(ctx, { type: 'Purchase Order', title: 'Stage rental order', partyId: vendor.id, sensitivity: 'Internal' });
    const asIssuer = createDocument(ctx, { type: 'Letter', title: 'Issued letter', issuingEntityId: vendor.id, sensitivity: 'Public' });
    const linked = createDocument(ctx, {
      type: 'Contract', title: 'Confidential stage contract', sensitivity: 'Confidential', entities: [{ entityId: vendor.id, role: 'named' }],
    });
    createDocument(ctx, { type: 'Purchase Order', title: 'Sound order', partyId: other.id, sensitivity: 'Internal' });

    const all = await api('GET', `/api/documents?entityId=${vendor.id}`);
    assert.equal(all.statusCode, 200);
    assert.deepEqual(all.json().documents.map((d) => d.id).sort(), [asParty.id, asIssuer.id, linked.id].sort());
    assert.equal(all.json().total, 3);
    const listed = (await api('GET', `/api/entities?kind=vendor&q=${encodeURIComponent('Example Stage Rentals')}`)).json().entities;
    assert.equal(listed[0].documentCount, 3, 'the list count covers every reference');
    assert.equal((await api('GET', `/api/entities/${vendor.id}`)).json().documentCount, 3);

    const intern = await internApp.inject({ url: `/api/documents?entityId=${vendor.id}` });
    assert.equal(intern.statusCode, 200);
    assert.deepEqual(intern.json().documents.map((d) => d.id).sort(), [asParty.id, asIssuer.id].sort(), 'the Confidential one is excluded');
    assert.equal(intern.json().total, 2);

    const bad = await api('GET', '/api/documents?entityId=abc');
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'INVALID_INPUT');
  });

  test('renditions and blobs above the user clearance are 403', async () => {
    const sha = (await api('GET', `/api/documents/${secret.id}`)).json().renditions[0].sha256;
    assert.equal((await app.inject({ url: `/blobs/${sha}/minutes.pdf` })).statusCode, 200);
    for (const url of [`/blobs/${sha}/minutes.pdf`, `/documents/${secret.id}/renditions/pdf`, `/api/documents/${secret.id}`]) {
      const r = await internApp.inject({ url });
      assert.equal(r.statusCode, 403, url);
      assert.doesNotMatch(r.body, /PDF-/);
    }
    assert.equal((await internApp.inject({ url: `/api/documents/${secret.id}` })).json().code, 'FORBIDDEN');
    const tree = await internApp.inject({ url: '/api/tree?node=01' });
    assert.ok(!tree.body.includes(secret.id), 'the Confidential document is left out of the tree');
    assert.ok((await app.inject({ url: '/api/tree?node=01' })).body.includes(secret.id));
  });

  test('unknown or malformed blobs, previews and assets are not served', async () => {
    assert.equal((await app.inject({ url: `/blobs/${'0'.repeat(64)}/x.pdf` })).statusCode, 404);
    assert.equal((await app.inject({ url: '/blobs/not-a-sha/x.pdf' })).statusCode, 400);
    assert.equal((await app.inject({ url: '/previews/abc/preview.pdf' })).statusCode, 404);
    assert.equal((await app.inject({ url: `/previews/${'a'.repeat(64)}/secret.txt` })).statusCode, 404);
    assert.equal((await app.inject({ url: '/assets/fonts/../../package.json' })).statusCode, 404);
    assert.equal((await app.inject({ url: '/assets/brands/nope/logo' })).statusCode, 404);
    assert.equal((await app.inject({ url: '/assets/brands/acme/signatures/nobody' })).statusCode, 404);
    assert.equal((await app.inject({ url: '/assets/brands/acme/fonts/..%2F..%2Fbrand.json' })).statusCode, 404);
    assert.equal((await app.inject({ url: '/workspace.json' })).statusCode, 404);
  });

  test('brand assets referenced by HTML renditions are served', async () => {
    const logo = await app.inject({ url: '/assets/brands/acme/logo' });
    assert.equal(logo.statusCode, 200);
    assert.equal(logo.headers['content-type'], 'image/png');
    const sig = await app.inject({ url: '/assets/brands/acme/signatures/ops' });
    assert.equal(sig.statusCode, 200);
    const bold = await app.inject({ url: '/assets/brands/acme/fonts/bold' });
    assert.equal(bold.headers['content-type'], 'font/ttf');
    const byName = await app.inject({ url: '/assets/brands/acme/fonts/Manrope-Bold.ttf' });
    assert.equal(byName.statusCode, 200);
    const builtin = await app.inject({ url: '/assets/fonts/Manrope/Manrope-Regular.ttf' });
    assert.equal(builtin.statusCode, 200);
  });

  test('state-changing requests need a same-origin Origin/Referer (or a JSON body)', async () => {
    const target = `/api/documents/${secret.id}/metadata`;
    const json = (headers) => app.inject({ method: 'POST', url: target, headers: { 'content-type': 'application/json', ...headers }, payload: JSON.stringify({ title: 'pwned' }) });
    const foreign = await json({ origin: 'http://evil.example' });
    assert.equal(foreign.statusCode, 403);
    assert.equal(foreign.json().code, 'CSRF_REJECTED');
    const noOrigin = await app.inject({ method: 'POST', url: target, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'title=pwned' });
    assert.equal(noOrigin.statusCode, 403);
    assert.equal((await json({ origin: 'null' })).statusCode, 403);
    assert.equal((await json({ referer: 'http://evil.example/page' })).statusCode, 403);
    const goodReferer = await app.inject({ method: 'POST', url: target, headers: { referer: 'http://localhost/documents', 'content-type': 'application/json' }, payload: JSON.stringify({ title: 'Secret minutes' }) });
    assert.equal(goodReferer.statusCode, 200);
    const sameOriginForm = await post(target, { title: 'pwned' });
    assert.equal(sameOriginForm.statusCode, 415, 'form bodies are no longer parsed');
    const multi = multipart({ type: 'Letter' }, { filename: 'a.txt', mime: 'text/plain', buffer: Buffer.from('hello') });
    assert.equal((await app.inject({ method: 'POST', url: '/api/upload', ...multi })).statusCode, 403, 'multipart without Origin or X-Dossier-Client');
    assert.equal((await api('GET', `/api/documents/${secret.id}`)).json().title, 'Secret minutes');
  });

  test('a Host header that is not loopback is refused (DNS rebinding)', async () => {
    const r = await app.inject({ url: '/', headers: { host: 'evil.example' } });
    assert.equal(r.statusCode, 421);
    assert.equal((await app.inject({ url: '/', headers: { host: '127.0.0.1:4400' } })).statusCode, 200);
  });
});
