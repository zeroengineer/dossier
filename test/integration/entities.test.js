import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { writeWorkspace } from '../helpers/workspace.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import {
  upsertEntity, getEntity, findEntities, relateEntities, unrelateEntities, seedEntities,
} from '../../src/services/entities.js';

function withCtx(fn, spec = {}) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    writeWorkspace(dir, spec);
    ctx = openContext({ home: dir, user: 'tester', dbFile: ':memory:', env: {} });
    return fn(ctx);
  } finally {
    ctx?.close();
    cleanup();
  }
}

const audits = (ctx, prefix = 'entity') => ctx.db.prepare('SELECT * FROM audit_log WHERE action LIKE ? ORDER BY id').all(`${prefix}%`);
const code = (c, extra = {}) => (err) => err?.name === 'DossierError' && err.code === c
  && Object.entries(extra).every(([k, v]) => err.details?.[k] === v);

test('upsertEntity creates an entity with aliases, attrs and brand, audits and emits entity:changed', () => withCtx((ctx) => {
  const events = [];
  ctx.repo.events.on('entity:changed', (p) => events.push(p));
  const e = upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited', aliases: ['Acme', 'Acme Events'], attrs: { code: 'ACME' }, brand: 'acme' });
  assert.equal(typeof e.id, 'number');
  assert.equal(e.kind, 'company');
  assert.equal(e.name, 'Acme Events Private Limited');
  assert.equal(e.key, 'acme events private limited');
  assert.equal(e.brand, 'acme');
  assert.deepEqual(e.attrs, { code: 'ACME' });
  assert.deepEqual(e.aliases, ['Acme', 'Acme Events']);
  assert.deepEqual(e.relations, []);
  assert.equal(e.documentCount, 0);
  assert.deepEqual(events, [{ ids: [e.id] }]);
  const [row] = audits(ctx);
  assert.equal(row.action, 'entity.create');
  assert.equal(row.target_kind, 'entity');
  assert.equal(row.target_id, String(e.id));
  assert.equal(row.actor, 'tester');
  assert.equal(row.before, null);
  assert.deepEqual(JSON.parse(row.after).aliases, ['Acme', 'Acme Events']);
}));

test('upsertEntity by normalised name updates the same row, keeps its display name and merges attrs', () => withCtx((ctx) => {
  const a = upsertEntity(ctx, { kind: 'client', name: 'Demo Retail LLP', attrs: { code: 'DEMO', email: 'x@example.com' } });
  const b = upsertEntity(ctx, { kind: 'client', name: '  demo  retail, llp. ', attrs: { email: 'y@example.com', code: null }, aliases: ['Demo Retail'] });
  assert.equal(b.id, a.id);
  assert.equal(b.name, 'Demo Retail LLP');
  assert.deepEqual(b.attrs, { email: 'y@example.com' });
  assert.deepEqual(b.aliases, ['Demo Retail']);
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM entities').get().n, 1);
  const rows = audits(ctx);
  assert.deepEqual(rows.map((r) => r.action), ['entity.create', 'entity.update']);
  assert.equal(JSON.parse(rows[1].before).attrs.email, 'x@example.com');
  assert.equal(JSON.parse(rows[1].after).attrs.email, 'y@example.com');

  const events = [];
  ctx.repo.events.on('entity:changed', (p) => events.push(p));
  upsertEntity(ctx, { kind: 'client', name: 'Demo Retail LLP', attrs: { email: 'y@example.com' }, aliases: ['demo retail'] });
  assert.equal(audits(ctx).length, 2, 'no audit row for an unchanged upsert');
  assert.deepEqual(events, []);
}));

test('the same name in different kinds is two entities', () => withCtx((ctx) => {
  const a = upsertEntity(ctx, { kind: 'business_line', name: 'Events' });
  const b = upsertEntity(ctx, { kind: 'engagement', name: 'Events' });
  assert.notEqual(a.id, b.id);
}));

test('upsertEntity by id renames, keeps the old name as an alias and refuses a kind change', () => withCtx((ctx) => {
  const e = upsertEntity(ctx, { kind: 'vendor', name: 'Example Sound Co', aliases: ['Example Sound and Light Co'] });
  const r = upsertEntity(ctx, { id: e.id, name: 'Example Sound and Light Co' });
  assert.equal(r.id, e.id);
  assert.equal(r.kind, 'vendor');
  assert.equal(r.name, 'Example Sound and Light Co');
  assert.deepEqual(r.aliases, ['Example Sound Co']);
  assert.equal(getEntity(ctx, 'example sound co', { kind: 'vendor' }).id, e.id);
  assert.throws(() => upsertEntity(ctx, { id: e.id, kind: 'client', name: 'X' }), code('INVALID_INPUT'));
  assert.throws(() => upsertEntity(ctx, { id: 9999, kind: 'vendor', name: 'X' }), code('ENTITY_NOT_FOUND'));
}));

test('duplicate detection: a name or alias colliding with another entity of the same kind', () => withCtx((ctx) => {
  const acme = upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited', aliases: ['Acme Events'] });
  const other = upsertEntity(ctx, { kind: 'company', name: 'Other Example Limited' });
  // new entity whose name is an existing alias
  assert.throws(() => upsertEntity(ctx, { kind: 'company', name: 'ACME events.' }), code('ENTITY_DUPLICATE', { existingId: acme.id }));
  // new entity whose alias is an existing canonical name
  assert.throws(() => upsertEntity(ctx, { kind: 'company', name: 'Acme Holdings', aliases: ['Acme Events Pvt Ltd', 'acme events private limited'] }),
    code('ENTITY_DUPLICATE', { existingId: acme.id }));
  // existing entity gaining an alias owned by another entity
  assert.throws(() => upsertEntity(ctx, { id: other.id, name: 'Other Example Limited', aliases: ['Acme Events'] }), code('ENTITY_DUPLICATE', { existingId: acme.id }));
  // renaming onto another entity's name
  assert.throws(() => upsertEntity(ctx, { id: other.id, name: 'Acme Events Private Limited' }), code('ENTITY_DUPLICATE', { existingId: acme.id }));
  // nothing was written by the failed calls
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM entities').get().n, 2);
  assert.deepEqual(getEntity(ctx, other.id).aliases, []);
  // a different kind is not a duplicate
  assert.equal(upsertEntity(ctx, { kind: 'client', name: 'Acme Events' }).kind, 'client');
}));

test('aliasOf adds the name and aliases as aliases of the named entity instead of failing', () => withCtx((ctx) => {
  const acme = upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited', aliases: ['Acme Events'] });
  const r = upsertEntity(ctx, { kind: 'company', name: 'Acme Events', aliases: ['Acme Events Pvt. Ltd.'], aliasOf: acme.id });
  assert.equal(r.id, acme.id);
  assert.deepEqual(r.aliases, ['Acme Events', 'Acme Events Pvt. Ltd.']);
  // aliasOf by name, with a name nobody owns yet
  const r2 = upsertEntity(ctx, { kind: 'company', name: 'ACME', aliasOf: 'acme events pvt ltd' });
  assert.equal(r2.id, acme.id);
  assert.deepEqual(r2.aliases, ['Acme Events', 'Acme Events Pvt. Ltd.', 'ACME']);
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM entities').get().n, 1);
  assert.deepEqual(audits(ctx).map((a) => a.action), ['entity.create', 'entity.update', 'entity.update']);
  // aliasOf naming a different entity than the one collided with still fails
  const other = upsertEntity(ctx, { kind: 'company', name: 'Other Example Limited' });
  assert.throws(() => upsertEntity(ctx, { kind: 'company', name: 'Acme', aliasOf: other.id }), code('ENTITY_DUPLICATE', { existingId: acme.id }));
  assert.throws(() => upsertEntity(ctx, { kind: 'client', name: 'Acme X', aliasOf: acme.id }), code('INVALID_INPUT'));
  assert.throws(() => upsertEntity(ctx, { kind: 'company', name: 'Acme X', aliasOf: 'no such company' }), code('ENTITY_NOT_FOUND'));
}));

test('aliasOf by name resolves within the entity kind (a name shared across kinds is not ambiguous)', () => withCtx((ctx) => {
  upsertEntity(ctx, { kind: 'company', name: 'Shared Example Name' });
  const client = upsertEntity(ctx, { kind: 'client', name: 'Shared Example Name' });
  const r = upsertEntity(ctx, { kind: 'client', name: 'SEN', aliasOf: 'shared example name' });
  assert.equal(r.id, client.id);
  assert.deepEqual(r.aliases, ['SEN']);
  // a name that only another kind owns is not found for this kind
  upsertEntity(ctx, { kind: 'vendor', name: 'Vendor Only Example' });
  assert.throws(() => upsertEntity(ctx, { kind: 'client', name: 'VOE', aliasOf: 'Vendor Only Example' }), code('ENTITY_NOT_FOUND'));
}));

test('invalid input is rejected with INVALID_INPUT', () => withCtx((ctx) => {
  assert.throws(() => upsertEntity(ctx, { kind: 'planet', name: 'Mars' }), code('INVALID_INPUT'));
  assert.throws(() => upsertEntity(ctx, { kind: 'client', name: ' ... ' }), code('INVALID_INPUT'));
  assert.throws(() => upsertEntity(ctx, { kind: 'client', name: 'Fine', aliases: ['--'] }), code('INVALID_INPUT'));
  assert.throws(() => upsertEntity(ctx, { kind: 'client', name: 'Fine', brand: 'nope' }), code('INVALID_INPUT'));
  assert.throws(() => upsertEntity(ctx, { kind: 'client', name: 'Fine', attrs: ['x'] }), code('INVALID_INPUT'));
  assert.equal(ctx.db.prepare('SELECT count(*) AS n FROM entities').get().n, 0);
}));

test('getEntity by id or name/alias, with relations in both directions and document count', () => withCtx((ctx) => {
  const acme = upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited', aliases: ['Acme'] });
  const jordan = upsertEntity(ctx, { kind: 'person', name: 'Jordan Placeholder' });
  const acmeClient = upsertEntity(ctx, { kind: 'client', name: 'Acme' });
  relateEntities(ctx, jordan.id, acme.id, 'employed_by', { since: '2025-01-01' });

  assert.equal(getEntity(ctx, acme.id).id, acme.id);
  assert.equal(getEntity(ctx, String(acme.id)).id, acme.id);
  assert.equal(getEntity(ctx, 'acme events private limited').id, acme.id);
  assert.equal(getEntity(ctx, 'acme', { kind: 'company' }).id, acme.id);
  assert.equal(getEntity(ctx, 'acme', { kind: 'client' }).id, acmeClient.id);
  assert.throws(() => getEntity(ctx, 'acme'), code('ENTITY_AMBIGUOUS'));
  assert.throws(() => getEntity(ctx, 'nobody'), code('ENTITY_NOT_FOUND'));
  assert.throws(() => getEntity(ctx, 9999), code('ENTITY_NOT_FOUND'));

  const a = getEntity(ctx, acme.id);
  assert.deepEqual(a.relations.map(({ id, ...r }) => r), [
    { role: 'employed_by', direction: 'in', entity: { id: jordan.id, kind: 'person', name: 'Jordan Placeholder' }, attrs: { since: '2025-01-01' } },
  ]);
  const j = getEntity(ctx, jordan.id);
  assert.equal(j.relations[0].direction, 'out');
  assert.equal(j.relations[0].entity.id, acme.id);

  ctx.db.exec(`INSERT INTO documents (id, type, party_id, party_type) VALUES ('DOC-000001', 'invoice', ${acmeClient.id}, 'Client')`);
  ctx.db.exec(`INSERT INTO documents (id, type, issuing_entity_id) VALUES ('DOC-000002', 'invoice', ${acme.id})`);
  ctx.db.exec(`INSERT INTO document_entities (document_id, entity_id, role) VALUES ('DOC-000002', ${acme.id}, 'issuer'), ('DOC-000001', ${acme.id}, 'named')`);
  ctx.repo.bump('documents'); // raw SQL bypasses the repo: mark the write so memoised entity views are rebuilt
  assert.equal(getEntity(ctx, acme.id).documentCount, 2);
  assert.equal(getEntity(ctx, acmeClient.id).documentCount, 1);
}));

test('findEntities matches canonical names and aliases, filters by kind and limits', () => withCtx((ctx) => {
  const acme = upsertEntity(ctx, { kind: 'company', name: 'Acme Events Private Limited', aliases: ['Acme', 'Acme Events'] });
  const tickets = upsertEntity(ctx, { kind: 'product', name: 'Acme Tickets' });
  const eiss = upsertEntity(ctx, { kind: 'client', name: 'Example Institute of Sample Studies', aliases: ['EISS'] });
  upsertEntity(ctx, { kind: 'client', name: '100% Example_Co' });

  assert.deepEqual(findEntities(ctx, { q: 'eiss' }).map((e) => e.id), [eiss.id]);
  assert.equal(findEntities(ctx, { q: 'eiss' })[0].matched, 'EISS');
  assert.deepEqual(findEntities(ctx, { q: 'ACME' }).map((e) => e.id).sort(), [acme.id, tickets.id].sort());
  assert.equal(findEntities(ctx, { q: 'acme' })[0].id, acme.id, 'exact alias match ranks first');
  assert.deepEqual(findEntities(ctx, { q: 'acme', kind: 'product' }).map((e) => e.id), [tickets.id]);
  assert.deepEqual(findEntities(ctx, { q: 'sample stud' }).map((e) => e.id), [eiss.id]);
  assert.equal(findEntities(ctx, {}).length, 4);
  assert.equal(findEntities(ctx, { limit: 2 }).length, 2);
  assert.equal(findEntities(ctx, { q: '%' }).length, 4, 'a punctuation-only query normalises to empty and lists everything');
  assert.deepEqual(findEntities(ctx, { q: 'no such thing' }), []);
  assert.throws(() => findEntities(ctx, { kind: 'planet' }), code('INVALID_INPUT'));
  const [hit] = findEntities(ctx, { q: 'tickets' });
  assert.deepEqual(Object.keys(hit).sort(), ['aliases', 'brand', 'id', 'kind', 'matched', 'name']);
}));

test('relateEntities / unrelateEntities: validation, idempotence, audit and events', () => withCtx((ctx) => {
  const client = upsertEntity(ctx, { kind: 'client', name: 'Demo Retail LLP' });
  const line = upsertEntity(ctx, { kind: 'business_line', name: 'Software and Services' });
  const events = [];
  ctx.repo.events.on('entity:changed', (p) => events.push(p));

  const rel = relateEntities(ctx, client.id, line.id, 'belongs_to_business_line');
  assert.equal(typeof rel.id, 'number');
  assert.deepEqual({ ...rel, id: 0 }, { id: 0, from: client.id, to: line.id, role: 'belongs_to_business_line', attrs: {} });
  assert.equal(relateEntities(ctx, client.id, line.id, 'belongs_to_business_line').id, rel.id, 'relating twice is a no-op');
  relateEntities(ctx, client.id, line.id, 'belongs_to_business_line', { primary: true });
  assert.deepEqual(getEntity(ctx, client.id).relations[0].attrs, { primary: true });
  assert.deepEqual(events, [{ ids: [client.id, line.id] }, { ids: [client.id, line.id] }]);

  assert.throws(() => relateEntities(ctx, client.id, line.id, 'friend_of'), code('INVALID_INPUT'));
  assert.throws(() => relateEntities(ctx, client.id, client.id, 'contact_of'), code('INVALID_INPUT'));
  assert.throws(() => relateEntities(ctx, client.id, 9999, 'contact_of'), code('ENTITY_NOT_FOUND'));

  assert.equal(unrelateEntities(ctx, client.id, line.id, 'belongs_to_business_line'), true);
  assert.equal(unrelateEntities(ctx, client.id, line.id, 'belongs_to_business_line'), false);
  assert.deepEqual(getEntity(ctx, line.id).relations, []);
  assert.deepEqual(audits(ctx, 'entity.%relate').map((a) => [a.action, a.target_kind]), [
    ['entity.relate', 'entity_relation'], ['entity.relate', 'entity_relation'], ['entity.unrelate', 'entity_relation'],
  ]);
}));

test('seedEntities loads the example seeds; seeding twice is a no-op', () => {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    const home = initWorkspace(join(dir, 'ws'));
    ctx = openContext({ home, user: 'tester', dbFile: ':memory:', env: {} });
    const first = seedEntities(ctx);
    assert.equal(first.entitiesCreated, ctx.ws.seeds.entities.length);
    assert.equal(first.relationsCreated, ctx.ws.seeds.relations.length);
    const acme = getEntity(ctx, 'Acme', { kind: 'company' });
    assert.equal(acme.brand, 'acme');
    assert.ok(acme.relations.some((r) => r.role === 'employed_by' && r.direction === 'in'));
    const auditCount = audits(ctx).length;
    const counts = () => ['entities', 'entity_aliases', 'entity_relations'].map((t) => ctx.db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n);
    const before = counts();

    const events = [];
    ctx.repo.events.on('entity:changed', (p) => events.push(p));
    const second = seedEntities(ctx, ctx.ws.seeds);
    assert.deepEqual(second, { entitiesCreated: 0, entitiesUpdated: 0, aliasesAdded: 0, relationsCreated: 0 });
    assert.deepEqual(counts(), before);
    assert.equal(audits(ctx).length, auditCount);
    assert.deepEqual(events, []);
  } finally {
    ctx?.close();
    cleanup();
  }
});

test('seedEntities keeps user edits, adds new aliases and resolves seeds by alias', () => withCtx((ctx) => {
  const seeds = {
    entities: [
      { kind: 'client', name: 'Demo Retail LLP', aliases: ['Demo Retail'], attrs: { code: 'DEMO' } },
      { kind: 'business_line', name: 'Software and Services' },
    ],
    relations: [{ from: { kind: 'client', name: 'Demo Retail LLP' }, to: { kind: 'business_line', name: 'Software and Services' }, role: 'belongs_to_business_line' }],
  };
  seedEntities(ctx, seeds);
  const demo = getEntity(ctx, 'Demo Retail LLP', { kind: 'client' });
  upsertEntity(ctx, { id: demo.id, name: 'Demo Retail Partners LLP', attrs: { code: 'DRP' } });
  seeds.entities[0].aliases.push('DR');
  const r = seedEntities(ctx, seeds);
  assert.deepEqual(r, { entitiesCreated: 0, entitiesUpdated: 1, aliasesAdded: 1, relationsCreated: 0 });
  const after = getEntity(ctx, demo.id);
  assert.equal(after.name, 'Demo Retail Partners LLP');
  assert.equal(after.attrs.code, 'DRP');
  assert.deepEqual(after.aliases, ['Demo Retail', 'Demo Retail LLP', 'DR']);
  assert.throws(() => seedEntities(ctx, { entities: [{ kind: 'planet', name: 'x' }] }), code('INVALID_INPUT'));
}));
