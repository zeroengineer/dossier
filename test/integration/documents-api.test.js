import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from '../helpers/tmp.js';
import { fakeSpaDir } from '../helpers/spa.js';
import { exampleSeries, writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { buildServer } from '../../src/server.js';
import { upsertEntity } from '../../src/services/entities.js';
import { countDocuments, createDocument, listDocuments } from '../../src/services/documents.js';

// GET /api/documents: the filters the documents table sends (type, status, partyId, from, to, limit, offset) and the
// `total` count used for pagination.

let tmp; let admin; let intern; let adminApp; let internApp;
const ids = {};
let client; let vendor;

before(() => {
  tmp = tmpDir();
  writeWorkspace(tmp.dir, {
    workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: { admin: { clearance: 'Confidential' }, intern: { clearance: 'Internal' } } },
    series: exampleSeries(),
  });
  admin = openContext({ home: tmp.dir, user: 'admin', env: {} });
  intern = openContext({ home: tmp.dir, user: 'intern', env: {} });
  client = upsertEntity(admin, { kind: 'client', name: 'Acme Events' });
  vendor = upsertEntity(admin, { kind: 'vendor', name: 'Example Supplies' });
  const mk = (key, meta) => { ids[key] = createDocument(admin, meta).id; };
  mk('inv1', { type: 'Invoice', title: 'Invoice one', docDate: '2026-01-10', partyId: client.id });
  mk('inv2', { type: 'Invoice', title: 'Invoice two', docDate: '2026-02-10', partyId: client.id, status: 'Sent' });
  mk('inv3', { type: 'Invoice', title: 'Invoice three', docDate: '2026-03-10', partyId: vendor.id, status: 'Sent' });
  mk('quote', { type: 'Quotation', title: 'Quote', docDate: '2026-02-20', partyId: client.id });
  mk('secret', { type: 'Invoice', title: 'Board invoice', docDate: '2026-02-15', partyId: client.id, sensitivity: 'Confidential' });
  const spaDir = fakeSpaDir(tmp.dir, 'web-dist');
  adminApp = buildServer(admin, { spaDir });
  internApp = buildServer(intern, { spaDir });
});

after(async () => {
  await adminApp?.close();
  await internApp?.close();
  admin?.close();
  intern?.close();
  tmp?.cleanup();
});

const get = (url, app = adminApp) => app.inject({ url });
const idsOf = (res) => res.json().documents.map((d) => d.id);

describe('countDocuments', () => {
  test('counts what listDocuments returns, ignoring limit and offset', () => {
    assert.equal(countDocuments(admin), 5);
    assert.equal(countDocuments(admin, { type: 'Invoice', limit: 1, offset: 3 }), 4);
    assert.equal(countDocuments(admin, { status: 'Sent' }), listDocuments(admin, { status: 'Sent' }).length);
    assert.equal(countDocuments(intern), 4, 'clearance-filtered like the list');
    assert.throws(() => countDocuments(admin, { colour: 'red' }), (e) => e.code === 'INVALID_INPUT');
  });
});

describe('GET /api/documents', () => {
  test('answers { documents, total } with total ignoring the page', async () => {
    const r = await get('/api/documents?limit=2&offset=1');
    assert.equal(r.statusCode, 200);
    assert.deepEqual(Object.keys(r.json()).sort(), ['documents', 'total']);
    assert.equal(r.json().total, 5);
    assert.deepEqual(idsOf(r), [ids.quote, ids.secret]);
  });

  test('filters by type, status, partyId and date range together', async () => {
    assert.deepEqual(idsOf(await get('/api/documents?type=Quotation')), [ids.quote]);
    const sent = await get('/api/documents?type=Invoice&status=Sent');
    assert.deepEqual(idsOf(sent), [ids.inv3, ids.inv2]);
    assert.equal(sent.json().total, 2);
    assert.deepEqual(idsOf(await get(`/api/documents?partyId=${vendor.id}`)), [ids.inv3]);
    const ranged = await get(`/api/documents?partyId=${client.id}&from=2026-02-01&to=2026-02-28`);
    assert.deepEqual(idsOf(ranged), [ids.quote, ids.secret, ids.inv2]);
    assert.equal(ranged.json().total, 3);
  });

  test('empty parameters are ignored', async () => {
    const r = await get('/api/documents?type=&status=&partyId=&from=&to=');
    assert.equal(r.json().total, 5);
  });

  test('total is clearance-filtered', async () => {
    const r = await get(`/api/documents?partyId=${client.id}`, internApp);
    assert.equal(r.json().total, 3);
    assert.ok(!idsOf(r).includes(ids.secret));
  });

  test('bad filters answer 400 INVALID_INPUT', async () => {
    for (const q of ['status=Lost', 'partyId=abc', 'limit=0', 'limit=9999', 'offset=-1', 'colour=red']) {
      const r = await get(`/api/documents?${q}`);
      assert.equal(r.statusCode, 400, q);
      assert.equal(r.json().code, 'INVALID_INPUT', q);
    }
  });
});
