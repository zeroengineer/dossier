import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOP_LEVEL, DEFAULT_ROUTES, financialYear, idSegment, leafIn, parseRouteValue, routeFor, routingConfig } from '../../src/domain/routing.js';
import { WorkspaceSchema, formatIssues } from '../../src/workspace/schemas.js';
import { assembleTree, findNode } from '../../src/services/hierarchy.js';

const client = (id, name) => ({ id, name, type: 'Client' });
let n = 0;
const doc = (over) => {
  n += 1;
  const id = over.id ?? `DOC-${String(n).padStart(6, '0')}`;
  return { id, type: 'Invoice', status: 'Draft', sensitivity: 'Internal', docDate: '2026-07-01', displayName: `${id}.pdf`, party: null, businessLine: null, engagement: null, ...over };
};
const ids = (node) => node.documents.map((d) => d.id);
const names = (node) => node.children.map((c) => c.name);
const at = (tree, id) => {
  const node = findNode(tree, id);
  assert.ok(node, `node ${id} exists`);
  return node;
};

const events = { id: 50, name: 'Events Line' };
const software = { id: 51, name: 'Software and Services' };

function fixture() {
  return [
    doc({ id: 'DOC-000001', type: 'Board Resolution' }),
    doc({ id: 'DOC-000002', type: 'Offer Letter', party: { id: 2, name: 'Jane Example', type: 'Person' } }),
    doc({ id: 'DOC-000003', type: 'Relieving Letter', party: { id: 2, name: 'Jane Example', type: 'Person' } }),
    doc({ id: 'DOC-000004', type: 'Invoice', party: client(3, 'Demo Retail LLP'), businessLine: events }),
    doc({ id: 'DOC-000005', type: 'Vendor Invoice', party: { id: 4, name: 'Example Hosting', type: 'Vendor' } }),
    doc({ id: 'DOC-000006', type: 'PRD', party: { id: 5, name: 'Widget App', type: 'Product' } }),
    doc({ id: 'DOC-000007', type: 'Bank Statement', docDate: '2027-03-31' }),
    doc({ id: 'DOC-000008', type: 'Tax Return', docDate: '2026-04-01' }),
    doc({ id: 'DOC-000009', type: 'Template' }),
    doc({ id: 'DOC-000010', type: 'Reference' }),
    doc({ id: 'DOC-000011', type: 'Agreement', party: { id: 6, name: 'Acme Labs LLP', type: 'GroupEntity' } }),
    doc({ id: 'DOC-000012', type: 'NDA', sensitivity: 'Restricted', party: client(3, 'Demo Retail LLP'), businessLine: events }),
    doc({ id: 'DOC-000013', type: 'Ledger', docDate: null }),
  ];
}

test('routing defaults, FY labels and id segments', () => {
  assert.equal(TOP_LEVEL.length, 10);
  assert.deepEqual(DEFAULT_ROUTES.Receipt, { top: null, leaf: 'Invoices and Receipts' });
  const cfg = routingConfig({});
  assert.deepEqual(routeFor('pitch  deck', cfg), { top: null, leaf: 'Marketing', known: true, override: false });
  assert.deepEqual(routeFor('Mystery Memo', cfg), { top: null, leaf: 'Other', known: false, override: false });
  assert.equal(routeFor('Invoice', routingConfig({ routing: { Invoice: 'Billing' } })).override, true);
  assert.equal(leafIn('products', 'Proposals and Pricing'), 'Pricing');
  assert.equal(leafIn('vendors', 'Invoices and Receipts'), 'Invoices Received');
  assert.equal(leafIn('people', 'Agreements'), 'Other');
  assert.equal(leafIn('group', 'Agreements'), 'Agreements', 'open leaf set');
  assert.equal(financialYear('2026-04-01'), 'FY 2026-27');
  assert.equal(financialYear('2027-03-31'), 'FY 2026-27');
  assert.equal(financialYear('2099-12-01'), 'FY 2099-00');
  assert.equal(financialYear(null), null);
  assert.equal(idSegment('Events - Demo Line'), 'events-demo-line');
  assert.deepEqual(parseRouteValue('06 Finance/Bank Statements'), { top: 'finance', leaf: 'Bank Statements' });
  assert.deepEqual(parseRouteValue('08 References'), { top: 'references', leaf: null });
  assert.deepEqual(parseRouteValue('Agreements'), { top: null, leaf: 'Agreements' });
});

test('the tree covers every top-level folder with the right sub-levels', () => {
  const tree = assembleTree(fixture(), { clearance: 'Restricted' });
  assert.deepEqual(names(tree), TOP_LEVEL);
  assert.deepEqual(tree.children.map((c) => c.id), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);

  assert.deepEqual(ids(at(tree, '01/board-and-governance')), ['DOC-000001']);
  assert.equal(at(tree, '01/board-and-governance').path, '01 Company/Board and Governance');
  assert.deepEqual(names(at(tree, '02/jane-example')), ['Exit', 'Onboarding']);
  assert.deepEqual(ids(at(tree, '02/jane-example/onboarding')), ['DOC-000002']);
  assert.deepEqual(ids(at(tree, '03/events-line/demo-retail-llp/invoices-and-receipts')), ['DOC-000004']);
  assert.deepEqual(ids(at(tree, '04/example-hosting/invoices-received')), ['DOC-000005']);
  assert.deepEqual(ids(at(tree, '05/widget-app/specifications')), ['DOC-000006']);
  assert.deepEqual(names(at(tree, '06')), ['FY 2026-27', 'Undated']);
  assert.deepEqual(names(at(tree, '06/fy-2026-27')), ['Bank Statements', 'Tax Returns']);
  assert.deepEqual(ids(at(tree, '06/undated/ledgers-and-reports')), ['DOC-000013']);
  assert.deepEqual(ids(at(tree, '07')), ['DOC-000009']);
  assert.deepEqual(ids(at(tree, '08')), ['DOC-000010']);
  assert.deepEqual(ids(at(tree, '09/acme-labs-llp/agreements')), ['DOC-000011']);
  assert.deepEqual(ids(at(tree, '10')), ['DOC-000012']);
  assert.equal(findNode(tree, '03/events-line/demo-retail-llp/agreements'), null, 'restricted doc is not also in the client folder');
  assert.deepEqual(at(tree, '07').documents[0], { id: 'DOC-000009', displayName: 'DOC-000009.pdf', status: 'Draft', sensitivity: 'Internal' });
});

test('restricted documents and the Restricted folder are hidden below Restricted clearance', () => {
  const tree = assembleTree(fixture(), { clearance: 'Confidential' });
  assert.deepEqual(names(tree), TOP_LEVEL.slice(0, 9));
  const all = [];
  const walk = (node) => { all.push(...ids(node)); node.children.forEach(walk); };
  walk(tree);
  assert.ok(!all.includes('DOC-000012'));
  assert.equal(all.length, 12);
  const pub = assembleTree([doc({ type: 'Template', sensitivity: 'Confidential' })], { clearance: 'Internal' });
  assert.deepEqual(ids(at(pub, '07')), [], 'documents above clearance are dropped even if passed in');
});

test('engagement level appears only when a client has more than one engagement', () => {
  const c = client(3, 'Demo Retail LLP');
  const e1 = { id: 70, name: 'Spring Expo 2026' };
  const e2 = { id: 71, name: 'Winter Gala 2026' };
  const one = assembleTree([
    doc({ id: 'DOC-000101', party: c, businessLine: events, engagement: e1 }),
    doc({ id: 'DOC-000102', party: c, businessLine: events }),
  ], { clearance: 'Confidential' });
  assert.deepEqual(names(at(one, '03/events-line/demo-retail-llp')), ['Invoices and Receipts']);
  assert.deepEqual(ids(at(one, '03/events-line/demo-retail-llp/invoices-and-receipts')), ['DOC-000101', 'DOC-000102']);

  const two = assembleTree([
    doc({ id: 'DOC-000101', party: c, businessLine: events, engagement: e1 }),
    doc({ id: 'DOC-000102', party: c, businessLine: events }),
    doc({ id: 'DOC-000103', type: 'MoU', party: c, businessLine: events, engagement: e2 }),
    doc({ id: 'DOC-000104', party: client(8, 'Other Client'), engagement: e1 }),
  ], { clearance: 'Confidential' });
  assert.deepEqual(names(at(two, '03/events-line/demo-retail-llp')), ['General', 'Spring Expo 2026', 'Winter Gala 2026']);
  assert.deepEqual(ids(at(two, '03/events-line/demo-retail-llp/general/invoices-and-receipts')), ['DOC-000102']);
  assert.deepEqual(ids(at(two, '03/events-line/demo-retail-llp/spring-expo-2026/invoices-and-receipts')), ['DOC-000101']);
  assert.deepEqual(ids(at(two, '03/events-line/demo-retail-llp/winter-gala-2026/agreements')), ['DOC-000103']);
  assert.deepEqual(ids(at(two, '03/unassigned/other-client/invoices-and-receipts')), ['DOC-000104'], 'no business line -> Unassigned');

  const hidden = assembleTree([
    doc({ id: 'DOC-000101', party: c, businessLine: events, engagement: e1 }),
    doc({ id: 'DOC-000103', party: c, businessLine: events, engagement: e2, sensitivity: 'Confidential' }),
  ], { clearance: 'Internal' });
  assert.deepEqual(names(at(hidden, '03/events-line/demo-retail-llp')), ['Invoices and Receipts'], 'counts only visible documents');
});

test('workspace overrides rename top-level folders and reroute types; unknown types go to Other', () => {
  const topLevel = TOP_LEVEL.map((t) => t.replace(/^\d\d /, 'X '));
  const tree = assembleTree([
    doc({ id: 'DOC-000201', type: 'Invoice', party: client(3, 'Demo Retail LLP'), businessLine: software }),
    doc({ id: 'DOC-000202', type: 'Brochure' }),
    doc({ id: 'DOC-000203', type: 'Mystery Memo', party: { id: 5, name: 'Widget App', type: 'Product' } }),
    doc({ id: 'DOC-000204', type: 'Statement of Work', party: client(3, 'Demo Retail LLP'), businessLine: software }),
    doc({ id: 'DOC-000205', type: 'Mystery Memo' }),
  ], {
    clearance: 'Confidential',
    hierarchy: { topLevel, routing: { Invoice: 'Billing', Brochure: '08 References/Brochures', 'statement of work': 'Agreements' } },
  });
  assert.deepEqual(names(tree), topLevel.slice(0, 9));
  assert.equal(at(tree, '03').path, 'X Clients');
  assert.deepEqual(ids(at(tree, '03/software-and-services/demo-retail-llp/billing')), ['DOC-000201']);
  assert.deepEqual(ids(at(tree, '03/software-and-services/demo-retail-llp/agreements')), ['DOC-000204']);
  assert.deepEqual(ids(at(tree, '08/brochures')), ['DOC-000202']);
  assert.deepEqual(ids(at(tree, '05/widget-app/other')), ['DOC-000203']);
  assert.deepEqual(ids(at(tree, '01/other')), ['DOC-000205'], 'no party -> company folder');
});

test('sibling folders whose names slug alike get distinct stable ids', () => {
  const tree = assembleTree([
    doc({ id: 'DOC-000301', party: client(10, 'A.B Events'), businessLine: events }),
    doc({ id: 'DOC-000302', party: client(11, 'AB Events'), businessLine: events }),
  ], { clearance: 'Confidential' });
  const kids = at(tree, '03/events-line').children.map((c) => c.id);
  assert.deepEqual(kids, ['03/events-line/a-b-events', '03/events-line/ab-events']);
  const before = assembleTree([
    doc({ id: 'DOC-000303', party: client(12, 'Demo Co'), businessLine: events }),
  ], { clearance: 'Confidential' });
  assert.deepEqual(at(before, '03/events-line').children.map((c) => c.id), ['03/events-line/demo-co']);
  const after = assembleTree([
    doc({ id: 'DOC-000303', party: client(12, 'Demo Co'), businessLine: events }),
    doc({ id: 'DOC-000304', party: client(13, 'Demo-Co'), businessLine: events }),
    doc({ id: 'DOC-000305', party: client(14, 'Unassigned') }),
    doc({ id: 'DOC-000306', party: client(15, 'Lone Client'), businessLine: { id: 16, name: 'Unassigned' } }),
  ], { clearance: 'Confidential' });
  assert.deepEqual(at(after, '03/events-line').children.map((c) => c.id), ['03/events-line/demo-co', '03/events-line/demo-co-13'],
    'a later entity with a clashing slug never renames the existing node');
  assert.deepEqual(at(after, '03').children.map((c) => c.id).sort(), ['03/events-line', '03/unassigned', '03/unassigned-16'],
    'the named Unassigned folder keeps the plain slug over an entity of the same name');
  assert.deepEqual(ids(at(after, '03/unassigned/unassigned')), [], 'client named Unassigned sits in the Unassigned folder');
  assert.deepEqual(ids(at(after, '03/unassigned-16/lone-client/invoices-and-receipts')), ['DOC-000306']);
});

test('leaves are limited to each top-level folder\'s B3 set', () => {
  const tree = assembleTree([
    doc({ id: 'DOC-000401', type: 'Quotation', party: { id: 5, name: 'Widget App', type: 'Product' } }),
    doc({ id: 'DOC-000402', type: 'Pricing Report', party: { id: 5, name: 'Widget App', type: 'Product' } }),
    doc({ id: 'DOC-000403', type: 'Agreement', party: { id: 5, name: 'Widget App', type: 'Product' } }),
    doc({ id: 'DOC-000404', type: 'Invoice', party: { id: 4, name: 'Example Hosting', type: 'Vendor' } }),
    doc({ id: 'DOC-000405', type: 'NDA', party: { id: 2, name: 'Jane Example', type: 'Person' } }),
    doc({ id: 'DOC-000406', type: 'Invoice', party: { id: 1, name: 'Acme Events Private Limited', type: 'Company' } }),
    doc({ id: 'DOC-000407', type: 'Invoice' }),
    doc({ id: 'DOC-000408', type: 'Vendor Invoice', party: client(3, 'Demo Retail LLP'), businessLine: events }),
  ], { clearance: 'Confidential' });
  assert.deepEqual(ids(at(tree, '05/widget-app/pricing')), ['DOC-000401', 'DOC-000402']);
  assert.deepEqual(ids(at(tree, '05/widget-app/specifications')), ['DOC-000403']);
  assert.deepEqual(ids(at(tree, '04/example-hosting/invoices-received')), ['DOC-000404']);
  assert.deepEqual(ids(at(tree, '02/jane-example/other')), ['DOC-000405']);
  assert.deepEqual(ids(at(tree, '01/other')), ['DOC-000406', 'DOC-000407']);
  assert.deepEqual(names(at(tree, '01')), ['Other']);
  assert.deepEqual(ids(at(tree, '03/events-line/demo-retail-llp/other')), ['DOC-000408']);
});

test('only sensitivity places documents in Restricted: restricted routing overrides are rejected or ignored', () => {
  const r = WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', hierarchy: { routing: { NDA: '10 Restricted', Invoice: '10 Restricted/Keys' } } });
  assert.equal(r.success, false);
  assert.match(formatIssues(r.error), /hierarchy\.routing\.NDA/);
  assert.match(formatIssues(r.error), /hierarchy\.routing\.Invoice/);
  const renamed = TOP_LEVEL.map((t, i) => (i === 9 ? 'Vault' : t));
  assert.equal(WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', hierarchy: { topLevel: renamed, routing: { NDA: 'Vault' } } }).success, false);
  assert.equal(WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', hierarchy: { routing: { NDA: 'Agreements' } } }).success, true);

  const items = [doc({ id: 'DOC-000501', type: 'NDA', party: client(3, 'Demo Retail LLP'), businessLine: events })];
  const hierarchy = { routing: { NDA: '10 Restricted' } };
  const staff = assembleTree(items, { clearance: 'Internal', hierarchy });
  assert.deepEqual(ids(at(staff, '03/events-line/demo-retail-llp/agreements')), ['DOC-000501'], 'override ignored, no crash');
  const boss = assembleTree(items, { clearance: 'Restricted', hierarchy });
  assert.deepEqual(ids(at(boss, '10')), []);
});
