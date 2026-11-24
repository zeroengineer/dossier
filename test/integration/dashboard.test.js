import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpDir } from '../helpers/tmp.js';
import { exampleSeries, minimalBrand, writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { buildServer } from '../../src/server.js';
import { createDocument, updateStatus } from '../../src/services/documents.js';
import { allocateNumber, listCounters } from '../../src/services/numbering.js';
import { dashboardSummary } from '../../src/services/dashboard.js';
import { todayIso } from '../../src/services/fields.js';

// Local calendar dates relative to today, the convention the dashboard uses.
const daysAgo = (n) => { const d = new Date(); return todayIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n)); };

let tmp; let admin; let intern; let adminApp; let internApp;
const ids = {};

before(() => {
  tmp = tmpDir();
  const home = tmp.dir;
  writeWorkspace(home, {
    workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: { admin: { clearance: 'Confidential' }, intern: { clearance: 'Internal' } } },
    brands: {
      acme: minimalBrand('acme', {
        assets: { logo: 'assets/logo.png', seal: 'assets/missing-seal.png', watermark: 'assets/missing-watermark.png' },
        signatories: [
          { id: 'sign-ops', name: 'Alex Example', title: 'Operations', signature: 'assets/missing-ops.png' },
          { id: 'sign-md', name: 'Sam Example', title: 'Director', signature: 'assets/missing-md.png', signatureLarge: 'assets/missing-md-large.png' },
        ],
      }),
      other: minimalBrand('other'),
    },
    series: exampleSeries(),
  });
  // Both logos exist; acme's seal, watermark and signature files do not.
  for (const b of ['acme', 'other']) {
    mkdirSync(join(home, 'brands', b, 'assets'), { recursive: true });
    writeFileSync(join(home, 'brands', b, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  admin = openContext({ home, user: 'admin', env: {} });
  intern = openContext({ home, user: 'intern', env: {} });

  const mk = (key, meta) => { ids[key] = createDocument(admin, meta).id; };
  // Internal, in range
  mk('inv1', { type: 'Invoice', title: 'Invoice one', docDate: daysAgo(0), amountMinor: 150000, currency: 'INR', sensitivity: 'Internal' });
  mk('inv2', { type: 'Invoice', title: 'Invoice two', docDate: daysAgo(3), amountMinor: 2550, currency: 'USD', sensitivity: 'Internal', status: 'Sent' });
  mk('inv3', { type: 'Invoice', title: 'Invoice three', docDate: daysAgo(3), amountMinor: 50000, currency: 'INR', sensitivity: 'Internal', status: 'Paid' });
  // Superseded invoice in range: counted as a document, not invoiced
  mk('invSup', { type: 'Invoice', title: 'Superseded invoice', docDate: daysAgo(1), amountMinor: 999999, currency: 'INR', sensitivity: 'Internal', status: 'Sent' });
  updateStatus(admin, ids.invSup, 'Superseded');
  // Not an invoice: never in invoiced
  mk('quote', { type: 'Quotation', title: 'Quote', docDate: daysAgo(2), amountMinor: 777, currency: 'INR', sensitivity: 'Internal' });
  // Internal, outside a 7-day range but inside 30 days
  mk('old', { type: 'Invoice', title: 'Older invoice', docDate: daysAgo(10), amountMinor: 1000, currency: 'INR', sensitivity: 'Internal', status: 'Sent' });
  // Internal, in the window before a 7-day range (days 7..13): previous period
  mk('prev', { type: 'Invoice', title: 'Previous invoice', docDate: daysAgo(7), amountMinor: 3000, currency: 'INR', sensitivity: 'Internal', status: 'Sent' });
  // Internal, no doc date: counted on its created (local) date, today
  mk('undated', { type: 'Letter', title: 'Undated letter', sensitivity: 'Internal' });
  // Confidential, in range: only the admin sees it
  mk('secret', { type: 'Invoice', title: 'Secret invoice', docDate: daysAgo(0), amountMinor: 10000000, currency: 'INR', sensitivity: 'Confidential' });
  mk('secretUsd', { type: 'Invoice', title: 'Secret USD', docDate: daysAgo(1), amountMinor: 4200, currency: 'EUR', sensitivity: 'Confidential' });
  // Number conflicts: one Internal pair, one Confidential pair
  mk('n1', { type: 'Report', title: 'Report A', numberSeries: 'report', docNumber: 'ACM-REP-2020-001', docDate: daysAgo(40), sensitivity: 'Internal', status: 'Sent' });
  mk('n2', { type: 'Report', title: 'Report B', numberSeries: 'report', docNumber: 'ACM-REP-2020-001', docDate: daysAgo(40), sensitivity: 'Internal', status: 'Sent' });
  mk('c1', { type: 'Report', title: 'Report C', numberSeries: 'report', docNumber: 'ACM-REP-2020-002', docDate: daysAgo(40), sensitivity: 'Confidential', status: 'Sent' });
  mk('c2', { type: 'Report', title: 'Report D', numberSeries: 'report', docNumber: 'ACM-REP-2020-002', docDate: daysAgo(40), sensitivity: 'Confidential', status: 'Sent' });
  // Counters: invoice-main is shared by debit-note and receipt
  allocateNumber(admin, 'invoice-main', { date: '2026-05-01' });
  allocateNumber(admin, 'debit-note', { date: '2026-05-01' });
  allocateNumber(admin, 'quotation', { date: '2026-05-01', code: 'EVT' });

  // The oldest document was edited last.
  admin.db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run('2999-01-01T00:00:00.000Z', ids.old);

  adminApp = buildServer(admin);
  internApp = buildServer(intern);
});

after(async () => {
  await adminApp?.close();
  await internApp?.close();
  admin?.close();
  intern?.close();
  tmp?.cleanup();
});

const get = async (app, qs = '') => app.inject({ url: `/api/dashboard${qs}` });

describe('GET /api/dashboard', () => {
  test('shape and range: last N local days inclusive of today', async () => {
    const r = await get(internApp, '?days=7');
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'], /application\/json/);
    const b = r.json();
    assert.deepEqual(Object.keys(b).sort(), ['counters', 'kpis', 'previous', 'range', 'recent', 'timeline', 'warnings']);
    assert.deepEqual(b.range, { days: 7, from: daysAgo(6), to: daysAgo(0) });
    assert.deepEqual(Object.keys(b.kpis).sort(), ['documents', 'drafts', 'invoiced', 'numberConflicts']);
  });

  test('days defaults to 30; anything but 7, 30 or 90 is INVALID_INPUT', async () => {
    const d = (await get(internApp)).json();
    assert.equal(d.range.days, 30);
    assert.equal(d.range.from, daysAgo(29));
    for (const bad of ['1', '14', 'abc', '30.0', '-7', '', '007', '030', '0', '%207']) {
      const r = await get(internApp, `?days=${bad}`);
      assert.equal(r.statusCode, 400, `days=${bad}`);
      assert.equal(r.json().code, 'INVALID_INPUT');
    }
    for (const ok of [7, 30, 90]) assert.equal((await get(internApp, `?days=${ok}`)).statusCode, 200);
  });

  test('timeline: one zero-filled entry per day, oldest first, summing to kpis.documents', async () => {
    const b = (await get(internApp, '?days=7')).json();
    assert.equal(b.timeline.length, 7);
    assert.deepEqual(b.timeline.map((t) => t.date), [6, 5, 4, 3, 2, 1, 0].map(daysAgo));
    const at = Object.fromEntries(b.timeline.map((t) => [t.date, t.count]));
    // today: inv1 + undated (created today); 3 days ago: inv2, inv3; 2: quote; 1: invSup
    assert.equal(at[daysAgo(0)], 2);
    assert.equal(at[daysAgo(1)], 1);
    assert.equal(at[daysAgo(2)], 1);
    assert.equal(at[daysAgo(3)], 2);
    assert.equal(at[daysAgo(4)], 0);
    assert.equal(b.kpis.documents, 6);
    assert.equal(b.timeline.reduce((s, t) => s + t.count, 0), b.kpis.documents);
    assert.equal((await get(internApp, '?days=90')).json().timeline.length, 90);
  });

  test('invoiced: Invoice type only, Superseded excluded, integer minor units per currency', async () => {
    const b = (await get(internApp, '?days=7')).json();
    assert.deepEqual(b.kpis.invoiced, [{ currency: 'INR', amountMinor: 200000 }, { currency: 'USD', amountMinor: 2550 }]);
    for (const x of b.kpis.invoiced) assert.ok(Number.isSafeInteger(x.amountMinor));
    const m = (await get(internApp, '?days=30')).json();
    assert.deepEqual(m.kpis.invoiced, [{ currency: 'INR', amountMinor: 204000 }, { currency: 'USD', amountMinor: 2550 }]);
  });

  test('previous: the same totals over the window just before the range', async () => {
    const b = (await get(internApp, '?days=7')).json();
    assert.deepEqual(b.previous, {
      from: daysAgo(13), to: daysAgo(7), documents: 2,
      invoiced: [{ currency: 'INR', amountMinor: 4000 }],
    });
  });

  test('drafts (all time) and numberConflicts count visible documents only', async () => {
    const i = (await get(internApp, '?days=7')).json();
    assert.equal(i.kpis.drafts, 3); // inv1, quote, undated
    assert.equal(i.kpis.numberConflicts, 1); // n2 (n1 holds the number)
    const a = (await get(adminApp, '?days=7')).json();
    assert.equal(a.kpis.drafts, 5); // + secret, secretUsd
    assert.equal(a.kpis.numberConflicts, 2); // + c2
  });

  test('clearance: an Internal user never sees counts or amounts of Confidential documents', async () => {
    const i = (await get(internApp, '?days=7')).json();
    const a = (await get(adminApp, '?days=7')).json();
    assert.equal(a.kpis.documents, i.kpis.documents + 2);
    assert.deepEqual(a.kpis.invoiced, [
      { currency: 'EUR', amountMinor: 4200 }, { currency: 'INR', amountMinor: 10200000 }, { currency: 'USD', amountMinor: 2550 },
    ]);
    const body = JSON.stringify(i);
    for (const k of ['secret', 'secretUsd', 'c1', 'c2']) assert.ok(!body.includes(ids[k]), `${k} leaked`);
    assert.ok(!body.includes('EUR'));
    assert.ok(!body.includes('10000000'));
    assert.ok(!body.includes('Secret'));
    assert.ok(i.recent.every((d) => d.sensitivity === 'Internal' || d.sensitivity === 'Public'));
    assert.ok(a.recent.some((d) => d.sensitivity === 'Confidential'));
  });

  test('recent: 10 latest visible documents by update time as DocumentSummary', async () => {
    const b = (await get(internApp, '?days=7')).json();
    assert.equal(b.recent.length, 10);
    assert.equal(b.recent[0].id, ids.old, 'ordered by update time, not by date or id');
    for (let k = 1; k < b.recent.length; k++) assert.ok(b.recent[k - 1].updatedAt >= b.recent[k].updatedAt);
    assert.deepEqual(Object.keys(b.recent[0]).sort(), [
      'amountMinor', 'currency', 'currentVersion', 'docDate', 'docNumber', 'dueDate', 'id', 'numberConflict', 'numberSeries',
      'party', 'sensitivity', 'status', 'title', 'type', 'updatedAt',
    ]);
  });

  test('counters: numbering rows of sequences mapped back to series ids', async () => {
    const b = (await get(internApp, '?days=7')).json();
    assert.deepEqual(b.counters, listCounters(intern));
    const byKey = Object.fromEntries(b.counters.map((c) => [c.key, c]));
    assert.ok(!b.counters.some((c) => c.key === 'doc-id'), 'the document id counter is not a series counter');
    const inv = byKey['num:invoice-main:ACME:2026'];
    assert.equal(inv.seriesId, 'invoice-main');
    assert.deepEqual(inv.seriesIds, ['debit-note', 'invoice-main', 'receipt']);
    assert.equal(inv.value, 3); // next number to be issued after two allocations
    const q = byKey['num:quotation:ACME:2026:C=EVT'];
    assert.equal(q.seriesId, 'quotation');
    assert.equal(q.value, 2);
    assert.ok(byKey['num:report:ACME:2020'], 'seeded by the uploaded numbers');
  });

  test('warnings: template errors, visible number conflicts, missing brand asset files', async () => {
    const i = (await get(internApp, '?days=7')).json();
    for (const w of i.warnings) assert.deepEqual(Object.keys(w).sort(), ['code', 'href', 'message']);
    const conflicts = i.warnings.filter((w) => w.code === 'NUMBER_CONFLICT');
    assert.deepEqual(conflicts.map((w) => w.href), [`/documents/${ids.n2}`]);
    assert.match(conflicts[0].message, /ACM-REP-2020-001/);
    const a = (await get(adminApp, '?days=7')).json();
    assert.deepEqual(a.warnings.filter((w) => w.code === 'NUMBER_CONFLICT').map((w) => w.href), [`/documents/${ids.n2}`, `/documents/${ids.c2}`]);
    const assets = i.warnings.filter((w) => w.code === 'BRAND_ASSET_MISSING');
    assert.deepEqual(assets, [{
      code: 'BRAND_ASSET_MISSING',
      message: 'Brand "acme": 5 asset files missing (seal, watermark, sign-ops, sign-md, sign-md (large)); placeholders are used',
      href: '/settings/brands/acme',
    }], 'one warning per brand; a brand whose files all exist has none');
  });

  test('warnings include templates that fail to load', () => {
    const { dir, cleanup } = tmpDir();
    let ctx;
    try {
      writeWorkspace(dir, { series: exampleSeries(), files: { 'templates/broken/template.json': '{ not json' } });
      ctx = openContext({ home: dir, user: 'tester', dbFile: ':memory:', env: {} });
      const w = dashboardSummary(ctx, { days: 7 }).warnings.filter((x) => x.href === '/templates');
      assert.equal(w.length, 1);
      assert.match(w[0].message, /broken/);
      assert.equal(typeof w[0].code, 'string');
    } finally {
      ctx?.close();
      cleanup();
    }
  });
});
