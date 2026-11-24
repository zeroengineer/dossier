import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { writeWorkspace } from '../helpers/workspace.js';
import { openContext, refreshWorkspace } from '../../src/context.js';
import { memoOf } from '../../src/cache/memo.js';
import { findEntities, getEntity, upsertEntity, relateEntities } from '../../src/services/entities.js';
import { createDocument, updateMetadata } from '../../src/services/documents.js';
import { buildTree } from '../../src/services/hierarchy.js';
import { getTemplate, listTemplates } from '../../src/services/templates.js';
import { getBrandFile } from '../../src/services/workspaceFiles.js';
import { reindexAll } from '../../src/services/searchIndex.js';
import { search, searchCacheOf, SEARCH_CACHE_MAX } from '../../src/services/search.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'templates');
const USERS = { tester: { clearance: 'Confidential' }, guest: { clearance: 'Public' } };

/** A workspace on disk and `open(user)` for connections to one database file (separate connections = processes). */
async function withHome(fn) {
  const { dir, cleanup } = tmpDir();
  const opened = [];
  try {
    writeWorkspace(dir, { workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: USERS } });
    const open = (user = 'tester') => {
      const ctx = openContext({ home: dir, user, dbFile: join(dir, 'data', 'test.sqlite'), env: {} });
      opened.push(ctx);
      return ctx;
    };
    return await fn(open, dir);
  } finally {
    for (const c of opened) c.close();
    cleanup();
  }
}

const docIds = (tree) => [tree, ...tree.children.flatMap(function all(n) { return [n, ...n.children.flatMap(all)]; })]
  .flatMap((n) => n.documents.map((d) => d.id)).sort();
const hitIds = (r) => r.hits.map((h) => h.document.id).sort();

test('entity lookups are memoised and rebuilt after each kind of in-process write', () => withHome((open) => {
  const ctx = open();
  const stats = memoOf(ctx).stats;
  const jordan = upsertEntity(ctx, { kind: 'person', name: 'Jordan Example' });
  const acme = upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited' });

  const a = getEntity(ctx, jordan.id);
  const hits = stats.hits;
  const b = getEntity(ctx, jordan.id);
  assert.equal(stats.hits, hits + 1, 'second lookup is a hit');
  assert.deepEqual(b, a);
  b.name = 'mutated by a caller';
  assert.equal(getEntity(ctx, jordan.id).name, 'Jordan Example', 'callers get copies');
  assert.equal(getEntity(ctx, 'jordan example').id, jordan.id);

  upsertEntity(ctx, { id: jordan.id, name: 'Jordan Renamed' }); // entities
  assert.equal(getEntity(ctx, jordan.id).name, 'Jordan Renamed');
  assert.equal(getEntity(ctx, 'jordan example').id, jordan.id, 'old name is now an alias');

  relateEntities(ctx, jordan.id, acme.id, 'employed_by'); // entity_relations
  assert.equal(getEntity(ctx, jordan.id).relations.length, 1);

  assert.equal(getEntity(ctx, acme.id).documentCount, 0);
  const doc = createDocument(ctx, { type: 'Note', title: 'Hello', partyId: acme.id, partyType: 'Company' }); // documents
  assert.equal(getEntity(ctx, acme.id).documentCount, 1);
  updateMetadata(ctx, doc.id, { entities: [{ entityId: jordan.id, role: 'named' }] }); // document_entities
  assert.equal(getEntity(ctx, jordan.id).documentCount, 1);

  assert.deepEqual(findEntities(ctx, { q: 'jordan' }).map((e) => e.id), [jordan.id]);
  const other = upsertEntity(ctx, { kind: 'person', name: 'Jordan Second' });
  assert.deepEqual(findEntities(ctx, { q: 'jordan' }).map((e) => e.id).sort(), [jordan.id, other.id].sort());
}));

test('the hierarchy tree is memoised per clearance and rebuilt after document writes', () => withHome((open) => {
  const ctx = open();
  assert.deepEqual(docIds(buildTree(ctx)), []);
  const hits = memoOf(ctx).stats.hits;
  buildTree(ctx);
  assert.equal(memoOf(ctx).stats.hits, hits + 1);
  const d1 = createDocument(ctx, { type: 'Note', title: 'One' });
  const secret = createDocument(ctx, { type: 'Note', title: 'Two', sensitivity: 'Confidential' });
  assert.deepEqual(docIds(buildTree(ctx)), [d1.id, secret.id].sort());
  const guestView = { ...ctx, user: { id: 'guest', clearance: 'Public' } };
  assert.deepEqual(docIds(buildTree(guestView)), [], 'another clearance has its own entry');
  updateMetadata(ctx, d1.id, { sensitivity: 'Public' });
  assert.deepEqual(docIds(buildTree(guestView)), [d1.id]);
  const tree = buildTree(ctx);
  tree.children.length = 0;
  assert.notEqual(buildTree(ctx).children.length, 0, 'callers get copies');
}));

test('the template registry follows template folder edits and workspace reloads', () => withHome(async (open, home) => {
  const ctx = open();
  const before = listTemplates(ctx).map((t) => t.id);
  assert.ok(!before.includes('test-memo'));
  listTemplates(ctx);
  cpSync(join(FIXTURES, 'test-memo'), join(home, 'templates', 'test-memo'), { recursive: true });
  assert.ok(listTemplates(ctx).some((t) => t.id === 'test-memo'), 'a new folder is seen without a restart');
  const t1 = await getTemplate(ctx, 'test-memo');
  t1.meta.title = 'mutated by a caller';
  writeFileSync(join(home, 'templates', 'test-memo', 'body.md'), 'Changed body for {{person.name}}: {{text}}\n');
  const t2 = await getTemplate(ctx, 'test-memo');
  assert.notEqual(t2.hash, t1.hash, 'an edited file changes the hash');
  assert.equal(t2.meta.title, 'Test memo');
  assert.match(t2.body, /Changed body/);
}));

test('brand resolution is memoised on the workspace hash and the brand file', () => withHome((open, home) => {
  const ctx = open();
  const file = join(home, 'brands', 'acme', 'brand.json');
  assert.equal(getBrandFile(ctx, 'acme').file.shortName, 'Acme');
  const hits = memoOf(ctx).stats.hits;
  getBrandFile(ctx, 'acme');
  assert.equal(memoOf(ctx).stats.hits, hits + 1);
  const body = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...body, shortName: 'Acme Two' }, null, 2));
  assert.equal(getBrandFile(ctx, 'acme').file.shortName, 'Acme Two', 'the hand-edited file is read again');
  assert.equal(getBrandFile(ctx, 'acme').resolved.shortName, 'Acme', 'resolved follows the loaded workspace');
  const flushes = memoOf(ctx).stats.flushes;
  assert.equal(refreshWorkspace(ctx).reloaded, true);
  assert.equal(getBrandFile(ctx, 'acme').resolved.shortName, 'Acme Two');
  assert.equal(memoOf(ctx).stats.flushes, flushes + 1, 'a configHash change flushes the memo');
}));

test('a write by another connection (another process) flushes the memo', () => withHome((open) => {
  const a = open();
  const b = open();
  const jordan = upsertEntity(a, { kind: 'person', name: 'Jordan Example' });
  assert.equal(getEntity(a, jordan.id).name, 'Jordan Example');
  assert.deepEqual(findEntities(a, { q: 'sam' }), []);
  assert.deepEqual(docIds(buildTree(a)), []);

  upsertEntity(b, { id: jordan.id, name: 'Jordan Renamed' });
  upsertEntity(b, { kind: 'person', name: 'Sam Sample' });
  const doc = createDocument(b, { type: 'Note', title: 'Filed elsewhere' });

  assert.equal(getEntity(a, jordan.id).name, 'Jordan Renamed');
  assert.equal(findEntities(a, { q: 'sam' }).length, 1);
  assert.deepEqual(docIds(buildTree(a)), [doc.id]);
  assert.ok(memoOf(a).stats.flushes >= 1);
}));

test('search results are cached (copies) and the cache is cleared by document and entity changes', () => withHome((open) => {
  const ctx = open();
  const cache = searchCacheOf(ctx);
  const d1 = createDocument(ctx, { type: 'Note', title: 'Harbour logistics' });
  const r1 = search(ctx, { q: 'harbour' });
  assert.deepEqual(hitIds(r1), [d1.id]);
  assert.equal(cache.lru.size, 1);
  r1.hits.length = 0;
  assert.deepEqual(hitIds(search(ctx, { q: 'harbour' })), [d1.id], 'callers get copies');
  assert.equal(cache.lru.size, 1, 'same options, same entry');
  search(ctx, { q: 'harbour', limit: 5 });
  assert.equal(cache.lru.size, 2);

  const d2 = createDocument(ctx, { type: 'Note', title: 'Harbour cranes' }); // document:changed
  assert.equal(cache.lru.size, 0);
  assert.deepEqual(hitIds(search(ctx, { q: 'harbour' })), [d1.id, d2.id].sort());

  search(ctx, { q: 'jordan' });
  assert.ok(cache.lru.size > 0);
  upsertEntity(ctx, { kind: 'person', name: 'Jordan Example' }); // entity:changed
  assert.equal(cache.lru.size, 0);
  assert.equal(search(ctx, { q: 'jordan' }).entities.length, 1);

  search(ctx, { q: 'harbour' });
  reindexAll(ctx); // no event, but the search index version moved
  search(ctx, { q: 'cranes' });
  assert.equal(cache.lru.size, 1);
}));

test('cached search results respect clearance', () => withHome((open) => {
  const ctx = open();
  const secret = createDocument(ctx, { type: 'Note', title: 'Harbour secret', sensitivity: 'Confidential' });
  assert.deepEqual(hitIds(search(ctx, { q: 'harbour' })), [secret.id]);
  const guest = { ...ctx, user: { id: 'guest', clearance: 'Public' } };
  assert.deepEqual(hitIds(search(guest, { q: 'harbour' })), []);
  assert.equal(searchCacheOf(ctx).lru.size, 2);
}));

test('a write by another connection clears the search cache', () => withHome((open) => {
  const a = open();
  const b = open();
  createDocument(a, { type: 'Note', title: 'Harbour logistics' });
  assert.equal(search(a, { q: 'harbour' }).hits.length, 1);
  createDocument(b, { type: 'Note', title: 'Harbour cranes' });
  assert.equal(search(a, { q: 'harbour' }).hits.length, 2);
}));

test(`the search cache keeps the ${SEARCH_CACHE_MAX} most recent queries`, () => withHome((open) => {
  const ctx = open();
  createDocument(ctx, { type: 'Note', title: 'Harbour logistics' });
  const { lru } = searchCacheOf(ctx);
  for (let i = 0; i <= SEARCH_CACHE_MAX; i++) search(ctx, { q: `word${i}` });
  assert.equal(lru.size, SEARCH_CACHE_MAX);
  const keys = [...lru.map.keys()];
  assert.ok(!keys.some((k) => k.includes('"word0"')), 'the oldest query was evicted');
  assert.ok(keys.some((k) => k.includes(`"word${SEARCH_CACHE_MAX}"`)));
}));
