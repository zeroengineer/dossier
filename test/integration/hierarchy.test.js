import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from '../helpers/tmp.js';
import { writeWorkspace } from '../helpers/workspace.js';
import { openContext } from '../../src/context.js';
import { upsertEntity, relateEntities } from '../../src/services/entities.js';
import { createDocument, addVersion } from '../../src/services/documents.js';
import { buildTree, getNode } from '../../src/services/hierarchy.js';
import { main } from '../../src/cli.js';

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const ids = (node) => node.documents.map((d) => d.id);
const capture = () => ({ text: '', write(s) { this.text += s; return true; } });

function withHome(fn, hierarchy = {}) {
  const { dir, cleanup } = tmpDir();
  try {
    writeWorkspace(dir, {
      workspace: {
        name: 'Test Workspace', defaultBrand: 'acme', hierarchy,
        users: { boss: { clearance: 'Restricted' }, staff: { clearance: 'Internal' } },
      },
    });
    return fn(dir);
  } finally {
    cleanup();
  }
}

function seed(home) {
  const ctx = openContext({ home, user: 'boss', env: {} });
  try {
    const line = upsertEntity(ctx, { kind: 'business_line', name: 'Events Line' });
    const demo = upsertEntity(ctx, { kind: 'client', name: 'Demo Retail LLP' });
    const solo = upsertEntity(ctx, { kind: 'client', name: 'Solo Client' });
    relateEntities(ctx, demo.id, line.id, 'belongs_to_business_line');
    const e1 = upsertEntity(ctx, { kind: 'engagement', name: 'Spring Expo 2026' });
    const e2 = upsertEntity(ctx, { kind: 'engagement', name: 'Winter Gala 2026' });
    const person = upsertEntity(ctx, { kind: 'person', name: 'Jane Example' });
    const inv = createDocument(ctx, { type: 'Invoice', partyId: demo.id, engagementId: e1.id, docNumber: 'ACME-2026-0001', docDate: '2026-07-14' });
    addVersion(ctx, inv.id, { renditions: [{ kind: 'pdf', buffer: Buffer.from('%PDF-1.7 a'), filename: 'a.pdf' }] });
    createDocument(ctx, { type: 'MoU', partyId: demo.id, engagementId: e2.id, docDate: '2026-05-02' });
    createDocument(ctx, { type: 'Quotation', partyId: demo.id, docDate: '2026-04-20' });
    createDocument(ctx, { type: 'Invoice', partyId: solo.id, engagementId: e1.id, docDate: '2026-06-01' });
    createDocument(ctx, { type: 'Offer Letter', partyId: person.id, docDate: '2026-01-10', sensitivity: 'Confidential' });
    createDocument(ctx, { type: 'Bank Statement', docDate: '2026-02-28' });
    createDocument(ctx, { type: 'Credentials Note', sensitivity: 'Restricted' });
    const other = upsertEntity(ctx, { kind: 'business_line', name: 'Software Line' });
    createDocument(ctx, { type: 'Agreement', partyId: demo.id, businessLineId: other.id, docDate: '2026-08-01' });
  } finally {
    ctx.close();
  }
}

test('buildTree routes stored documents using entity relations, engagements and clearance', () => withHome((home) => {
  seed(home);
  const ctx = openContext({ home, user: 'boss', env: {} });
  try {
    const tree = buildTree(ctx);
    assert.equal(tree.children.length, 10);
    const client = getNode(ctx, '03/events-line/demo-retail-llp');
    assert.deepEqual(client.children.map((c) => c.name), ['General', 'Spring Expo 2026', 'Winter Gala 2026']);
    const leaf = getNode(ctx, '03/events-line/demo-retail-llp/spring-expo-2026/invoices-and-receipts');
    assert.deepEqual(leaf.documents, [{ id: 'DOC-000001', displayName: '2026-07-14_DemoRetailLLP_Invoice_ACME-2026-0001_v1.pdf', status: 'Draft', sensitivity: 'Internal' }]);
    assert.deepEqual(ids(getNode(ctx, '03/events-line/demo-retail-llp/general/proposals-and-pricing')), ['DOC-000003']);
    assert.deepEqual(getNode(ctx, '03/unassigned/solo-client').children.map((c) => c.name), ['Invoices and Receipts'], 'one engagement: no level');
    assert.deepEqual(ids(getNode(ctx, '02/jane-example/onboarding')), ['DOC-000005']);
    assert.deepEqual(ids(getNode(ctx, '06/fy-2025-26/bank-statements')), ['DOC-000006']);
    assert.deepEqual(ids(getNode(ctx, '10')), ['DOC-000007']);
    assert.deepEqual(ids(getNode(ctx, '03/software-line/demo-retail-llp/general/agreements')), ['DOC-000008'],
      'documents.business_line_id beats the client relation');
    assert.equal(getNode(ctx, '/').id, '');
    assert.throws(() => getNode(ctx, '03/nowhere'), code('NODE_NOT_FOUND'));
  } finally {
    ctx.close();
  }

  const staff = openContext({ home, user: 'staff', env: {} });
  try {
    const tree = buildTree(staff);
    assert.equal(tree.children.length, 9);
    assert.throws(() => getNode(staff, '10'), code('NODE_NOT_FOUND'));
    assert.throws(() => getNode(staff, '02/jane-example'), code('NODE_NOT_FOUND'), 'Confidential offer letter hidden');
  } finally {
    staff.close();
  }
}));

test('workspace hierarchy overrides apply through the service', () => withHome((home) => {
  seed(home);
  const ctx = openContext({ home, user: 'boss', env: {} });
  try {
    assert.equal(getNode(ctx, '03').name, 'C Clients');
    assert.deepEqual(ids(getNode(ctx, '03/unassigned/solo-client/billing')), ['DOC-000004']);
  } finally {
    ctx.close();
  }
}, {
  topLevel: ['A Company', 'B People', 'C Clients', 'D Vendors', 'E Products', 'F Finance', 'G Templates', 'H References', 'I Group', 'J Restricted'],
  routing: { Invoice: 'Billing' },
}));

test('dossier tree prints the tree, a subtree, folders only or JSON', async () => {
  const { dir, cleanup } = tmpDir();
  try {
    writeWorkspace(dir, { workspace: { name: 'Test Workspace', defaultBrand: 'acme', users: { boss: { clearance: 'Restricted' } } } });
    seed(dir);
    const env = { DOSSIER_HOME: dir, DOSSIER_USER: 'boss' };
    let out = capture(); let err = capture();
    assert.equal(await main(['tree'], { stdout: out, stderr: err, env, cwd: dir }), 0, err.text);
    assert.match(out.text, /^01 Company {2}\(0\) {2}\[01\]$/m);
    assert.match(out.text, /^ {6}Spring Expo 2026 {2}\(1\)/m);
    assert.match(out.text, /- 2026-07-14_DemoRetailLLP_Invoice_ACME-2026-0001_v1\.pdf {2}\[DOC-000001, Draft\]/);
    assert.match(out.text, /^10 Restricted {2}\(1\)/m);

    out = capture();
    assert.equal(await main(['tree', '03/events-line', '--folders'], { stdout: out, stderr: err, env, cwd: dir }), 0, err.text);
    assert.ok(out.text.startsWith('Events Line  (3)  [03/events-line]\n'));
    assert.doesNotMatch(out.text, /DOC-/);

    out = capture();
    assert.equal(await main(['tree', '06', '--json'], { stdout: out, stderr: err, env, cwd: dir }), 0, err.text);
    assert.equal(JSON.parse(out.text).children[0].name, 'FY 2025-26');

    err = capture();
    assert.equal(await main(['tree', '99'], { stdout: capture(), stderr: err, env, cwd: dir }), 1);
    assert.match(err.text, /No folder 99/);
  } finally {
    cleanup();
  }
});
