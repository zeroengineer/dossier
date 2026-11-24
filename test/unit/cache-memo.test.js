import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lru } from '../../src/cache/lru.js';
import { createMemo, WS } from '../../src/cache/memo.js';

/** A fake context: table versions, a data_version and a workspace hash the test moves by hand. */
function fakeCtx() {
  const versions = new Map();
  const state = { dataVersion: 1, inTx: false };
  return {
    state,
    db: { dataVersion: () => state.dataVersion, inTx: () => state.inTx },
    repo: { version: (t) => versions.get(t) ?? 0, bump: (t) => versions.set(t, (versions.get(t) ?? 0) + 1) },
    ws: { configHash: 'h1' },
  };
}

/** memo(key, deps) over a counter, so each miss is visible. */
function counting(memo) {
  let runs = 0;
  const get = (key, deps) => memo(key, deps, () => ({ key, run: ++runs }));
  return { get, runs: () => runs };
}

test('Lru keeps the most recently used entries', () => {
  const lru = new Lru(2);
  lru.set('a', 1).set('b', 2);
  assert.equal(lru.get('a'), 1); // a is now newer than b
  lru.set('c', 3);
  assert.deepEqual([...lru.map.keys()], ['a', 'c']);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.size, 2);
  assert.throws(() => new Lru(0), RangeError);
});

test('memo: a hit returns the cached value until a dependency table is bumped', () => {
  const ctx = fakeCtx();
  const memo = createMemo(ctx);
  const c = counting(memo);
  const first = c.get('e:1', ['entities']);
  assert.equal(c.get('e:1', ['entities']), first);
  assert.equal(c.runs(), 1);
  assert.deepEqual(memo.stats, { hits: 1, misses: 1, flushes: 0 });

  ctx.repo.bump('documents'); // not a dependency of e:1
  assert.equal(c.get('e:1', ['entities']), first);
  ctx.repo.bump('entities');
  const second = c.get('e:1', ['entities']);
  assert.notEqual(second, first);
  assert.equal(c.runs(), 2);
});

test('memo: each table of a multi-table key invalidates it; other keys stay cached', () => {
  const ctx = fakeCtx();
  const c = counting(createMemo(ctx));
  const deps = ['documents', 'entities', 'document_entities', 'entity_relations'];
  c.get('tree', deps);
  const other = c.get('names', ['entities']);
  for (const t of deps) {
    const before = c.runs();
    c.get('tree', deps);
    assert.equal(c.runs(), before, `cached before ${t} is written`);
    ctx.repo.bump(t);
    c.get('tree', deps);
    assert.equal(c.runs(), before + 1, `rebuilt after ${t} is written`);
  }
  ctx.repo.bump('templates');
  assert.equal(c.get('tree', deps).run, c.runs());
  // `names` depends on entities only, bumped once above.
  assert.notEqual(c.get('names', ['entities']), other);
});

test('memo: another process committing (data_version) flushes everything', () => {
  const ctx = fakeCtx();
  const memo = createMemo(ctx);
  const c = counting(memo);
  const a = c.get('a', ['entities']);
  const b = c.get('b', ['templates']);
  ctx.state.dataVersion = 2;
  assert.notEqual(c.get('a', ['entities']), a);
  assert.notEqual(c.get('b', ['templates']), b);
  assert.equal(memo.stats.flushes, 1);
});

test('memo: a workspace configHash change flushes everything; WS keys follow the hash', () => {
  const ctx = fakeCtx();
  const memo = createMemo(ctx);
  const c = counting(memo);
  const a = c.get('a', ['entities']);
  const brand = c.get('brand:acme', [WS]);
  assert.equal(c.get('brand:acme', [WS]), brand);
  ctx.ws = { configHash: 'h2' };
  assert.notEqual(c.get('a', ['entities']), a);
  assert.notEqual(c.get('brand:acme', [WS]), brand);
  assert.equal(memo.stats.flushes, 1);
});

test('memo: bypassed inside a transaction, a throwing fn caches nothing, promises are refused', () => {
  const ctx = fakeCtx();
  const memo = createMemo(ctx);
  const c = counting(memo);
  c.get('a', ['entities']);
  ctx.state.inTx = true;
  c.get('a', ['entities']);
  c.get('a', ['entities']);
  assert.equal(c.runs(), 3);
  ctx.state.inTx = false;

  let calls = 0;
  const boom = () => memo('x', ['entities'], () => { calls++; throw new Error('nope'); });
  assert.throws(boom, /nope/);
  assert.throws(boom, /nope/);
  assert.equal(calls, 2);
  assert.throws(() => memo('p', [], async () => 1), /synchronous/);
});

test('memo: fn writes are part of the tag (a registry upsert does not invalidate its own value)', () => {
  const ctx = fakeCtx();
  const memo = createMemo(ctx);
  let runs = 0;
  const scan = () => memo('templates', ['templates'], () => {
    runs++;
    ctx.repo.bump('templates'); // the scan upserts registry rows
    return runs;
  });
  scan();
  scan();
  assert.equal(runs, 1);
});

test('memo: entries beyond max are evicted least recently used first', () => {
  const ctx = fakeCtx();
  const c = counting(createMemo(ctx, { max: 2 }));
  c.get('a', []);
  c.get('b', []);
  c.get('a', []);
  c.get('c', []); // evicts b
  const runs = c.runs();
  c.get('a', []);
  assert.equal(c.runs(), runs);
  c.get('b', []);
  assert.equal(c.runs(), runs + 1);
});
