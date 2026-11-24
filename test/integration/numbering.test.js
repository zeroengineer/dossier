import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { tmpDir } from '../helpers/tmp.js';
import { minimalBrand, writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { allocateNumber, peekNumber, seedCounter, registerExisting } from '../../src/services/numbering.js';

const SERIES = [
  { id: 'invoice-main', pattern: 'ACM-{YYYY}-{####}', scope: 'brand+year', start: 1 },
  { id: 'debit-note', pattern: 'ACM-DN-{YYYY}-{####}', scope: 'brand+year', counter: 'invoice-main' },
  { id: 'receipt', pattern: 'ACM-REC-{YYYY}-{####}', scope: 'brand+year', counter: 'invoice-main' },
  { id: 'quotation', pattern: 'ACM-Q-{CODE}-{YYYY}-{##}', scope: 'brand+year' },
  { id: 'settlement', pattern: 'FSS/{CLIENT}/{YYYY}/{###}', scope: 'brand+year+client' },
  { id: 'fy-series', pattern: 'ACM/{FY}/{###}', scope: 'brand+year', start: 100 },
  { id: 'global', pattern: '{BRAND}-{#}', scope: 'global' },
];

function setup(dir) {
  writeWorkspace(dir, {
    workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: { tester: { clearance: 'Confidential' } } },
    brands: { acme: minimalBrand('acme'), beta: minimalBrand('beta') },
    series: SERIES,
  });
}

function withCtx(fn) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    setup(dir);
    ctx = openContext({ home: dir, user: 'tester', dbFile: ':memory:', env: {} });
    return fn(ctx);
  } finally {
    ctx?.close();
    cleanup();
  }
}

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const d = { date: '2026-06-01' };

test('invoice, debit note and receipt share one counter', () => withCtx((ctx) => {
  assert.equal(allocateNumber(ctx, 'invoice-main', d).number, 'ACM-2026-0001');
  assert.equal(allocateNumber(ctx, 'debit-note', d).number, 'ACM-DN-2026-0002');
  const r = allocateNumber(ctx, 'receipt', d);
  assert.deepEqual(r, { number: 'ACM-REC-2026-0003', seq: 3, scopeKey: 'num:invoice-main:ACME:2026' });
  assert.equal(allocateNumber(ctx, 'invoice-main', d).number, 'ACM-2026-0004');
}));

test('a new year starts a new counter; brands count separately', () => withCtx((ctx) => {
  allocateNumber(ctx, 'invoice-main', { date: '2026-12-31' });
  allocateNumber(ctx, 'invoice-main', { date: '2026-12-31' });
  assert.equal(allocateNumber(ctx, 'invoice-main', { date: '2027-01-01' }).number, 'ACM-2027-0001');
  assert.equal(allocateNumber(ctx, 'invoice-main', { date: '2026-11-01' }).number, 'ACM-2026-0003');
  assert.equal(allocateNumber(ctx, 'invoice-main', { date: '2026-11-01', brandId: 'beta' }).number, 'ACM-2026-0001');
}));

test('financial-year series roll over in April and start at series.start', () => withCtx((ctx) => {
  assert.equal(allocateNumber(ctx, 'fy-series', { date: '2026-03-31' }).number, 'ACM/2025-26/100');
  assert.equal(allocateNumber(ctx, 'fy-series', { date: '2025-04-01' }).number, 'ACM/2025-26/101');
  const r = allocateNumber(ctx, 'fy-series', { date: '2026-04-01' });
  assert.equal(r.number, 'ACM/2026-27/100');
  assert.equal(r.scopeKey, 'num:fy-series:ACME:FY2026-27');
}));

test('client scope keeps one counter per client', () => withCtx((ctx) => {
  assert.equal(allocateNumber(ctx, 'settlement', { ...d, client: 'drl' }).number, 'FSS/DRL/2026/001');
  assert.equal(allocateNumber(ctx, 'settlement', { ...d, client: 'drl' }).number, 'FSS/DRL/2026/002');
  assert.equal(allocateNumber(ctx, 'settlement', { ...d, client: 'Other Co' }).number, 'FSS/OTHER-CO/2026/001');
}));

test('CODE is per document and does not split the counter', () => withCtx((ctx) => {
  assert.equal(allocateNumber(ctx, 'quotation', { ...d, code: 'ev' }).number, 'ACM-Q-EV-2026-01');
  assert.equal(allocateNumber(ctx, 'quotation', { ...d, code: 'pr' }).number, 'ACM-Q-PR-2026-02');
}));

test('global scope ignores brand and year', () => withCtx((ctx) => {
  assert.equal(allocateNumber(ctx, 'global', { date: '2026-01-01' }).number, 'ACME-1');
  assert.equal(allocateNumber(ctx, 'global', { date: '2027-01-01', brandId: 'beta' }).number, 'BETA-2');
}));

test('errors: unknown series, missing vars, unknown brand; nothing is consumed', () => withCtx((ctx) => {
  assert.throws(() => allocateNumber(ctx, 'nope', d), code('SERIES_UNKNOWN'));
  assert.throws(() => peekNumber(ctx, 'nope', d), code('SERIES_UNKNOWN'));
  assert.throws(() => allocateNumber(ctx, 'settlement', d), code('NUMBER_VAR_MISSING'));
  assert.throws(() => allocateNumber(ctx, 'quotation', d), code('NUMBER_VAR_MISSING'));
  assert.throws(() => allocateNumber(ctx, 'invoice-main', { ...d, brandId: 'zeta' }), code('BRAND_NOT_FOUND'));
  assert.throws(() => allocateNumber(ctx, 'invoice-main', { date: '2026-13-01' }), code('INVALID_INPUT'));
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM sequences WHERE scope_key LIKE ?').get('num:%').n, 0);
  assert.equal(allocateNumber(ctx, 'quotation', { ...d, code: 'X' }).seq, 1);
}));

test('allocation joins the caller transaction and rolls back with it', () => withCtx((ctx) => {
  assert.throws(() => ctx.repo.tx(() => {
    allocateNumber(ctx, 'invoice-main', d);
    allocateNumber(ctx, 'receipt', d);
    throw new Error('boom');
  }), /boom/);
  const n = ctx.repo.tx(() => allocateNumber(ctx, 'invoice-main', d).number);
  assert.equal(n, 'ACM-2026-0001');
}));

test('peekNumber shows the next number without taking it', () => withCtx((ctx) => {
  assert.deepEqual(peekNumber(ctx, 'invoice-main', d), { number: 'ACM-2026-0001', seq: 1, scopeKey: 'num:invoice-main:ACME:2026' });
  assert.equal(peekNumber(ctx, 'fy-series', d).number, 'ACM/2026-27/100');
  allocateNumber(ctx, 'invoice-main', d);
  assert.equal(peekNumber(ctx, 'receipt', d).number, 'ACM-REC-2026-0002');
  assert.equal(peekNumber(ctx, 'receipt', d).number, 'ACM-REC-2026-0002');
  assert.equal(allocateNumber(ctx, 'receipt', d).number, 'ACM-REC-2026-0002');
}));

test('seedCounter only moves forward and is audited', () => withCtx((ctx) => {
  assert.deepEqual(seedCounter(ctx, 'invoice-main', { year: 2026 }, 131), { scopeKey: 'num:invoice-main:ACME:2026', next: 131, moved: true });
  assert.deepEqual(seedCounter(ctx, 'debit-note', { date: '2026-02-02' }, 50), { scopeKey: 'num:invoice-main:ACME:2026', next: 131, moved: false });
  assert.equal(allocateNumber(ctx, 'debit-note', d).number, 'ACM-DN-2026-0131');
  assert.equal(seedCounter(ctx, 'fy-series', { fy: '2026-27' }, 5).next, 100);
  assert.equal(allocateNumber(ctx, 'fy-series', d).number, 'ACM/2026-27/100');
  const audits = ctx.db.prepare("SELECT target_id, before, after FROM audit_log WHERE action = 'sequence.seed'").all();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].target_id, 'num:invoice-main:ACME:2026');
  assert.deepEqual(JSON.parse(audits[0].after), { next: 131, seriesId: 'invoice-main' });
  assert.throws(() => seedCounter(ctx, 'invoice-main', { year: 2026 }, -1), code('INVALID_INPUT'));
  assert.throws(() => seedCounter(ctx, 'invoice-main', {}, 10), code('NUMBER_VAR_MISSING'));
  assert.throws(() => seedCounter(ctx, 'settlement', { year: 2026 }, 10), code('NUMBER_VAR_MISSING'));
}));

test('registerExisting parses legacy numbers and seeds past them', () => withCtx((ctx) => {
  const r = registerExisting(ctx, 'invoice-main', 'ACM-2026-0133');
  assert.deepEqual(r, { scopeKey: 'num:invoice-main:ACME:2026', next: 134, moved: true, seq: 133, vars: { year: 2026, seq: 133 } });
  assert.equal(registerExisting(ctx, 'receipt', 'ACM-REC-2026-0131').moved, false);
  assert.equal(allocateNumber(ctx, 'receipt', d).number, 'ACM-REC-2026-0134');
  registerExisting(ctx, 'settlement', 'FSS/DRL/2026/007');
  assert.equal(allocateNumber(ctx, 'settlement', { ...d, client: 'drl' }).number, 'FSS/DRL/2026/008');
  registerExisting(ctx, 'global', 'BETA-41');
  assert.equal(allocateNumber(ctx, 'global', d).number, 'ACME-42');
  registerExisting(ctx, 'invoice-main', 'ACM-2026-0009', { brandId: 'beta' });
  assert.equal(allocateNumber(ctx, 'invoice-main', { ...d, brandId: 'beta' }).number, 'ACM-2026-0010');
  assert.throws(() => registerExisting(ctx, 'invoice-main', 'ACM-DN-2026-0001'), code('NUMBER_UNPARSEABLE'));
  assert.throws(() => registerExisting(ctx, 'nope', 'X'), code('SERIES_UNKNOWN'));
}));

test('two connections on one file: sequential allocations continue the same counter', () => {
  const { dir, cleanup } = tmpDir();
  const dbFile = join(dir, 'data', 'dossier.db');
  let a; let b;
  try {
    setup(dir);
    a = openContext({ home: dir, user: 'tester', dbFile, env: {} });
    b = openContext({ home: dir, user: 'tester', dbFile, env: {} });
    const got = [a, b, a, b].map((c, i) => allocateNumber(c, ['invoice-main', 'debit-note', 'receipt', 'invoice-main'][i], d).seq);
    assert.deepEqual(got, [1, 2, 3, 4]);
  } finally {
    a?.close();
    b?.close();
    cleanup();
  }
});

test('concurrent allocation from parallel workers never duplicates a number', async () => {
  const { dir, cleanup } = tmpDir();
  const dbFile = join(dir, 'data', 'dossier.db');
  try {
    setup(dir);
    openContext({ home: dir, user: 'tester', dbFile, env: {} }).close(); // migrate once before the workers start
    const workers = 4;
    const count = 40;
    const url = new URL('../helpers/numbering-worker.js', import.meta.url);
    const run = () => new Promise((resolve, reject) => {
      const w = new Worker(url, { workerData: { home: dir, dbFile, count, seriesIds: ['invoice-main', 'debit-note', 'receipt'] } });
      w.once('message', resolve);
      w.once('error', reject);
    });
    const results = (await Promise.all(Array.from({ length: workers }, run))).flat();
    assert.equal(results.length, workers * count);
    const seqs = results.map((n) => Number(n.slice(-4))).sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: workers * count }, (_, i) => i + 1));
  } finally {
    cleanup();
  }
});
