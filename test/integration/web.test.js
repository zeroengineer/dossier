import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { makePdf } from '../helpers/pdf.js';
import { fixtureInput } from '../helpers/templateRender.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { seedEntities, getEntity } from '../../src/services/entities.js';
import { createDocument, addVersion } from '../../src/services/documents.js';
import { buildServer } from '../../src/server.js';

const ORIGIN = 'http://localhost:80';
let tmp; let ctx; let app; let internCtx; let internApp;
let pdfBytes; let secret; // a Confidential document the Internal user may not read

/** urlencoded form post from this site. */
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
  // No built web app here: unmatched page routes answer 503 (see spa.test.js for the built case).
  app = buildServer(ctx, { spaDir: join(tmp.dir, 'no-dist') });
  internApp = buildServer(internCtx, { spaDir: join(tmp.dir, 'no-dist') });

  pdfBytes = await makePdf(['Confidential board minutes about the sample merger']);
  secret = createDocument(ctx, { type: 'Board Resolution', title: 'Secret minutes', sensitivity: 'Confidential' });
  addVersion(ctx, secret.id, { renditions: [{ kind: 'pdf', buffer: pdfBytes, filename: 'minutes.pdf', mime: 'application/pdf' }] });
});

after(async () => {
  await app?.close();
  await internApp?.close();
  ctx?.close();
  internCtx?.close();
  tmp?.cleanup();
});

describe('pages', () => {
  test('every page answers 200 with its content', async () => {
    const client = getEntity(ctx, 'Demo Retail LLP', { kind: 'client' });
    const pages = [
      ['/', /Vault/],
      ['/?node=01', /Secret minutes|01 Company/],
      [`/documents/${secret.id}`, /Secret minutes/],
      ['/upload', /New version of an existing document/],
      ['/search', /<form method="get" action="\/search"/],
      ['/search?q=minutes', /Secret minutes/],
      ['/generate', /Invoice/],
      ['/generate/invoice', /Items/],
      ['/templates', /debit-note/],
      ['/entities', /Demo Retail LLP/],
      [`/entities/${client.id}`, /belongs_to_business_line/],
      ['/settings', /Acme Events Private Limited/],
    ];
    for (const [url, re] of pages) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 200, `${url}: ${r.body.slice(0, 300)}`);
      assert.match(r.headers['content-type'], /^text\/html/);
      assert.match(r.body, re, url);
      assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    }
  });

  test('unknown old pages and documents render a 404 page; API answers JSON; other paths go to the web app', async () => {
    const page = await app.inject({ url: '/documents/DOC-999999' });
    assert.equal(page.statusCode, 404);
    assert.match(page.body, /DOCUMENT_NOT_FOUND/);
    const route = await app.inject({ url: '/settings/nowhere' });
    assert.equal(route.statusCode, 404);
    assert.match(route.headers['content-type'], /text\/html/);
    // Other unmatched page paths are web-app routes (503 here because the web app is not built).
    assert.equal((await app.inject({ url: '/nowhere' })).statusCode, 503);
    const json = await app.inject({ url: '/api/nowhere' });
    assert.equal(json.statusCode, 404);
    assert.equal(json.json().code, 'NOT_FOUND');
  });

  test('interpolated data is escaped in pages', async () => {
    const created = await api('POST', '/api/entities', { kind: 'person', name: '<script>alert(1)</script> Doe' });
    assert.equal(created.statusCode, 201);
    const r = await app.inject({ url: `/entities/${created.json().id}` });
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(r.body, /<script>alert/);
    assert.match(r.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Doe/);
    const list = await app.inject({ url: '/entities?q=%3Cscript%3E' });
    assert.doesNotMatch(list.body, /<script>alert/);
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
    const form = await post(`/documents/${d.id}/metadata`, { title: 'Date check', docDate: '2026-13-45' });
    assert.equal(form.statusCode, 400);
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

  test('the upload form redirects to the new document; refused files re-render the form', async () => {
    const body = multipart({ type: 'Letter', title: 'Welcome note', partyId: '' }, { filename: 'welcome.md', mime: 'text/markdown', buffer: Buffer.from('# Welcome\n\nHello there.\n') });
    const r = await app.inject({ method: 'POST', url: '/upload', ...body, headers: { ...body.headers, origin: ORIGIN } });
    assert.equal(r.statusCode, 303);
    assert.match(r.headers.location, /^\/documents\/DOC-\d{6}\?uploaded=1$/);
    const page = await app.inject({ url: r.headers.location });
    assert.match(page.body, /Welcome note/);
    assert.match(page.body, /File uploaded/);

    const bad = multipart({ type: 'Letter' }, { filename: 'server.pem', mime: 'text/plain', buffer: Buffer.from('-----BEGIN PRIVATE KEY-----') });
    const refused = await app.inject({ method: 'POST', url: '/upload', ...bad, headers: { ...bad.headers, origin: ORIGIN } });
    assert.equal(refused.statusCode, 400);
    assert.match(refused.body, /SECRET_REJECTED/);
    assert.match(refused.body, /New version of an existing document/);
  });
});

describe('generate in the browser', () => {
  test('preview then generate an invoice from the form, then regenerate with force', async () => {
    const fields = {
      $brand: 'acme', client: 'Example Institute of Sample Studies', date: '2026-07-14', 'billTo.name': '', 'billTo.address': '',
      'items.0.description': 'Platform services', 'items.0.hsn': '', 'items.0.amount': '12,500.00',
      'items.1.description': '', 'items.1.hsn': '', 'items.1.amount': '', // an untouched row is dropped
      taxMode: '', bankAccount: '', rowHeight: '', descriptionWeight: '', seal: '',
    };
    const preview = await post('/generate/invoice', { ...fields, $action: 'preview' });
    assert.equal(preview.statusCode, 200, preview.body.slice(0, 500));
    const src = preview.body.match(/<iframe class="pdf" id="preview-frame" title="Draft preview" src="([^"]+)"/)?.[1];
    assert.match(src, /^\/previews\/[0-9a-f]{64}\/preview\.pdf$/);
    const file = await app.inject({ url: src });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'application/pdf');
    assert.equal(file.rawPayload.subarray(0, 4).toString(), '%PDF');

    const viaJs = await post('/generate/invoice/preview', fields, { accept: 'application/json' });
    assert.equal(viaJs.json().ok, true);
    assert.deepEqual(viaJs.json().warnings, []);

    const missing = await post('/generate/invoice', { ...fields, 'items.0.description': '', 'items.0.amount': '', $action: 'generate' });
    assert.equal(missing.statusCode, 400);
    assert.match(missing.body, /Required fields are empty/);
    assert.match(missing.body, /Items <code>items<\/code>/);

    const gen = await post('/generate/invoice', { ...fields, $action: 'generate' });
    assert.equal(gen.statusCode, 303, gen.body.slice(0, 500));
    const [, id] = gen.headers.location.match(/^\/documents\/(DOC-\d+)\?generated=1$/);
    const page = await app.inject({ url: gen.headers.location });
    assert.match(page.body, /Document generated\./);
    assert.match(page.body, /ACM-2026-\d{4}/);
    assert.match(page.body, /Regenerate as a new version/);
    const pdf = await app.inject({ url: `/documents/${id}/renditions/pdf` });
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    const html = await app.inject({ url: `/documents/${id}/renditions/html?version=1&download=1` });
    assert.equal(html.headers['content-security-policy'], 'sandbox');
    assert.match(html.headers['content-disposition'], /^attachment;/);

    // Sent documents are locked: the form says so, and only "force" regenerates.
    assert.equal((await post(`/documents/${id}/status`, { status: 'Sent' })).statusCode, 303);
    const form = await app.inject({ url: `/generate/invoice?documentId=${id}` });
    assert.match(form.body, /name="\$force"/);
    assert.match(form.body, /Platform services/, 'the form is prefilled from the current version');
    const locked = await post('/generate/invoice', { ...fields, $documentId: id, $action: 'generate' });
    assert.equal(locked.statusCode, 409);
    assert.match(locked.body, /STATUS_LOCKED/);
    const forced = await post('/generate/invoice', { ...fields, $documentId: id, $force: 'true', $note: 'fixed amount', $action: 'generate' });
    assert.equal(forced.statusCode, 303);
    const doc = (await api('GET', `/api/documents/${id}`)).json();
    assert.equal(doc.currentVersion, 2);
    assert.equal(doc.status, 'Draft');
  });

  test('placeholder warnings reach the document page after a form generate', async () => {
    const gen = await post('/generate/mou', { ...fixtureInput('mou'), $action: 'generate' });
    assert.equal(gen.statusCode, 303, gen.body.slice(0, 500));
    assert.match(gen.headers.location, /warn=partnerOffice/);
    const page = await app.inject({ url: gen.headers.location });
    assert.match(page.body, /some placeholders printed empty/);
    assert.match(page.body, /partnerOffice/);
  });

  test('document page forms: status, link, unlink and metadata', async () => {
    const a = createDocument(ctx, { type: 'Invoice', title: 'Form invoice' });
    const b = createDocument(ctx, { type: 'Receipt', title: 'Form receipt' });
    assert.equal((await post(`/documents/${b.id}/links`, { type: 'pays', toId: a.id })).statusCode, 303);
    let page = await app.inject({ url: `/documents/${b.id}` });
    assert.match(page.body, /this pays →/);
    assert.equal((await post(`/documents/${b.id}/links/delete`, { fromId: b.id, toId: a.id, type: 'pays' })).statusCode, 303);
    page = await app.inject({ url: `/documents/${b.id}` });
    assert.match(page.body, /No related documents/);
    assert.equal((await post(`/documents/${a.id}/metadata`, { title: 'Renamed invoice', docNumber: '', docDate: '2026-05-01', dueDate: '', sensitivity: 'Internal' })).statusCode, 303);
    assert.equal((await api('GET', `/api/documents/${a.id}`)).json().title, 'Renamed invoice');
    const bad = await post(`/documents/${a.id}/status`, { status: 'Nonsense' });
    assert.equal(bad.statusCode, 400);
  });

  test('entity forms create, edit and relate', async () => {
    const c = await post('/entities', { kind: 'client', name: 'Form Client Ltd', aliases: 'FCL, Form Client', brand: '', attrs: '{"code":"FCL"}' });
    assert.equal(c.statusCode, 303);
    const id = c.headers.location.match(/\/entities\/(\d+)/)[1];
    const e = await post(`/entities/${id}`, { name: 'Form Client Limited', aliases: '', brand: '', attrs: '' });
    assert.equal(e.statusCode, 303);
    const r = await post(`/entities/${id}/relations`, { role: 'belongs_to_business_line', to: 'Events' });
    assert.equal(r.statusCode, 303);
    const page = await app.inject({ url: `/entities/${id}` });
    assert.match(page.body, /Form Client Limited/);
    assert.match(page.body, /FCL/);
    assert.match(page.body, /belongs_to_business_line/);
    const dup = await post('/entities', { kind: 'client', name: 'Other', aliases: 'FCL' });
    assert.equal(dup.statusCode, 409);
    assert.match(dup.body, /ENTITY_DUPLICATE/);
    const badJson = await post(`/entities/${id}`, { name: 'Form Client Limited', attrs: '{nope' });
    assert.equal(badJson.statusCode, 400);
  });
});

describe('access control', () => {
  test('renditions and blobs above the user clearance are 403', async () => {
    const sha = (await api('GET', `/api/documents/${secret.id}`)).json().renditions[0].sha256;
    assert.equal((await app.inject({ url: `/blobs/${sha}/minutes.pdf` })).statusCode, 200);
    for (const url of [`/blobs/${sha}/minutes.pdf`, `/documents/${secret.id}/renditions/pdf`, `/api/documents/${secret.id}`, `/documents/${secret.id}`]) {
      const r = await internApp.inject({ url });
      assert.equal(r.statusCode, 403, url);
      assert.doesNotMatch(r.body, /PDF-/);
    }
    assert.equal((await internApp.inject({ url: `/api/documents/${secret.id}` })).json().code, 'FORBIDDEN');
    const tree = await internApp.inject({ url: '/' });
    assert.doesNotMatch(tree.body, /Secret minutes/);
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
    const target = `/documents/${secret.id}/metadata`;
    const foreign = await post(target, { title: 'pwned' }, { origin: 'http://evil.example' });
    assert.equal(foreign.statusCode, 403);
    assert.equal(foreign.json().code, 'CSRF_REJECTED');
    const noOrigin = await app.inject({ method: 'POST', url: target, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'title=pwned' });
    assert.equal(noOrigin.statusCode, 403);
    const nullOrigin = await post(target, { title: 'pwned' }, { origin: 'null' });
    assert.equal(nullOrigin.statusCode, 403);
    const badReferer = await app.inject({ method: 'POST', url: target, headers: { referer: 'http://evil.example/page', 'content-type': 'application/x-www-form-urlencoded' }, payload: 'title=pwned' });
    assert.equal(badReferer.statusCode, 403);
    const goodReferer = await app.inject({ method: 'POST', url: target, headers: { referer: 'http://localhost/documents', 'content-type': 'application/x-www-form-urlencoded' }, payload: 'title=Secret%20minutes' });
    assert.equal(goodReferer.statusCode, 303);
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
