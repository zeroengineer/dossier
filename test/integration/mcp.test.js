import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { tmpDir } from '../helpers/tmp.js';
import { fixtureInput } from '../helpers/templateRender.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { seedEntities } from '../../src/services/entities.js';
import { LIFECYCLE, createMcpServer, errorPayload } from '../../src/mcp.js';
import { DossierError } from '../../src/errors.js';
import { REPO_ROOT } from '../../src/paths.js';

const TOOLS = ['generate_document', 'get_document', 'get_entity', 'get_template', 'link_documents', 'list_templates',
  'preview_document', 'resolve_fields', 'search', 'update_status', 'upsert_entity'];

let tmp; let home; let ctx; let client; let server; const logs = [];

/** Call a tool; returns { data, isError } with data = structuredContent (checked against the JSON text). */
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].type, 'text');
  const data = JSON.parse(r.content[0].text);
  assert.deepEqual(r.structuredContent, data, 'structuredContent mirrors the text content');
  return { data, isError: r.isError === true };
}
async function ok(name, args) {
  const r = await call(name, args);
  assert.equal(r.isError, false, `${name} failed: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function err(name, args) {
  const r = await call(name, args);
  assert.equal(r.isError, true, `${name} should fail`);
  assert.deepEqual(Object.keys(r.data).sort(), ['code', 'details', 'hint', 'message']);
  assert.ok(r.data.hint.length > 0);
  return r.data;
}

before(async () => {
  tmp = tmpDir();
  home = join(tmp.dir, 'ws');
  initWorkspace(home);
  ctx = openContext({ home, user: 'demo', actor: 'mcp:demo', dbFile: ':memory:', env: {} });
  seedEntities(ctx);
  server = createMcpServer(ctx, { log: (m) => logs.push(m) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

after(async () => {
  await client?.close();
  await server?.close();
  ctx?.close();
  tmp?.cleanup();
});

describe('MCP server (in-memory transport)', () => {
  test('lists every tool with an input schema, and the resources', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
    for (const t of tools) assert.equal(t.inputSchema.type, 'object', t.name);
    const gen = tools.find((t) => t.name === 'generate_document');
    assert.deepEqual(gen.inputSchema.required.sort(), ['input', 'template_id']);
    for (const k of ['brand_id', 'status', 'document_id', 'force']) assert.ok(gen.inputSchema.properties[k], k);
    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((r) => r.uri), ['dossier://tree']);
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.deepEqual(resourceTemplates.map((r) => r.uriTemplate), ['dossier://document/{id}']);
  });

  test('templates: list, get, resolve', async () => {
    const list = await ok('list_templates');
    const dn = list.templates.find((t) => t.id === 'debit-note');
    assert.equal(dn.usable, true);
    assert.deepEqual(dn.renditions, ['pdf', 'html', 'md']);
    assert.deepEqual(list.errors, []);

    const t = await ok('get_template', { id: 'debit-note' });
    assert.equal(t.numbering.series, 'brand');
    assert.ok(t.fields.some((f) => f.name === 'items' && f.required && f.item.amount === 'money'));
    assert.equal(t.params.title, 'DEBIT NOTE');

    const r = await ok('resolve_fields', { template_id: 'debit-note', input: {} });
    assert.ok(r.missing.some((m) => m.name === 'client'));
    const full = await ok('resolve_fields', { template_id: 'debit-note', input: fixtureInput('debit-note'), brand_id: 'acme' });
    assert.deepEqual({ missing: full.missing, errors: full.errors }, { missing: [], errors: [] });
    assert.equal(full.values.billTo.name, 'Example Institute of Sample Studies');

    assert.equal((await err('get_template', { id: 'no-such' })).code, 'TEMPLATE_NOT_FOUND');
  });

  test('preview returns paths, a summary and warnings, never bytes', async () => {
    const missing = await ok('preview_document', { template_id: 'debit-note', input: {} });
    assert.equal(missing.ok, false);
    assert.ok(missing.missing.length > 0);
    assert.match(missing.summary, /missing field/);

    const p = await ok('preview_document', { template_id: 'debit-note', input: fixtureInput('debit-note') });
    assert.equal(p.ok, true);
    assert.deepEqual(p.renditions.map((x) => x.kind), ['pdf', 'html', 'md']);
    for (const x of p.renditions) {
      assert.ok(x.path.startsWith(join(ctx.config.dataDir, 'previews')), x.path);
      assert.equal(readFileSync(x.path).length, x.bytes);
      assert.deepEqual(Object.keys(x).sort(), ['bytes', 'kind', 'path']);
    }
    assert.ok(Array.isArray(p.warnings));
    assert.match(p.summary, /^Draft debit-note rendered: pdf \(\d+ bytes\)/);
  });

  test('generate files a document (audited as mcp:<user>); get, search, status, regenerate, link', async () => {
    const g = await ok('generate_document', { template_id: 'debit-note', input: fixtureInput('debit-note'), brand_id: 'acme' });
    assert.match(g.documentId, /^DOC-\d{6}$/);
    assert.ok(g.number);
    assert.equal(g.versionNo, 1);
    assert.ok(Array.isArray(g.warnings));
    for (const r of g.renditions) assert.ok(existsSync(r.path), r.path);
    assert.match(g.summary, new RegExp(`^Generated ${g.documentId} \\(${g.number}\\) version 1`));
    const actors = ctx.db.prepare("SELECT DISTINCT actor FROM audit_log WHERE action LIKE 'document.%'").all().map((r) => r.actor);
    assert.deepEqual(actors, ['mcp:demo']);

    const doc = await ok('get_document', { id: g.documentId });
    assert.equal(doc.docNumber, g.number);
    assert.equal(doc.status, 'Draft');
    assert.ok(doc.renditions.every((r) => existsSync(r.path)));
    assert.ok(doc.versions[0].renditions.every((r) => r.path));

    const s = await ok('search', { q: g.number });
    assert.equal(s.hits[0].document.id, g.documentId);
    const none = await ok('search', { q: g.number, status: 'Paid' });
    assert.deepEqual(none.hits, []);

    const sent = await ok('update_status', { document_id: g.documentId, status: 'Sent' });
    assert.equal(sent.status, 'Sent');
    const locked = await err('generate_document', { template_id: 'debit-note', input: fixtureInput('debit-note'), document_id: g.documentId });
    assert.equal(locked.code, 'STATUS_LOCKED');
    assert.match(locked.hint, /force/);
    const again = await ok('generate_document', {
      template_id: 'debit-note', input: fixtureInput('debit-note'), document_id: g.documentId, force: true,
    });
    assert.equal(again.documentId, g.documentId);
    assert.equal(again.number, g.number);
    assert.equal(again.versionNo, 2);
    assert.match(again.summary, /^Regenerated /);

    const other = await ok('generate_document', { template_id: 'debit-note', input: fixtureInput('debit-note') });
    const link = await ok('link_documents', { from_id: other.documentId, to_id: g.documentId, type: 'follows' });
    assert.equal(link.type, 'follows');
    assert.ok((await ok('get_document', { id: g.documentId })).relations.some((r) => r.document?.id === other.documentId));

    assert.equal((await err('update_status', { document_id: g.documentId, status: 'Paid' })).code, 'INVALID_STATUS_TRANSITION');
    assert.equal((await err('get_document', { id: 'DOC-999999' })).code, 'DOCUMENT_NOT_FOUND');
    const fieldsMissing = await err('generate_document', { template_id: 'debit-note', input: {} });
    assert.equal(fieldsMissing.code, 'FIELDS_MISSING');
    assert.ok(fieldsMissing.details.missing.length > 0);
  });

  test('generator warnings reach preview and generate results', async () => {
    const input = {
      ...fixtureInput('pricing-report'),
      sections: [{ title: 'Overview', blocks: [{ type: 'paragraph', text: 'Pricing for {event} at {venue}.' }] }],
    };
    delete input.engagement;
    const expected = [['PLACEHOLDER_EMPTY', 'event'], ['PLACEHOLDER_EMPTY', 'venue']];
    const p = await ok('preview_document', { template_id: 'pricing-report', input });
    assert.deepEqual(p.warnings.map((w) => [w.code, w.name]), expected);
    assert.match(p.summary, /; 2 warnings \(event, venue\)$/);
    const g = await ok('generate_document', { template_id: 'pricing-report', input });
    assert.deepEqual(g.warnings.map((w) => [w.code, w.name]), expected);
    assert.match(g.summary, /2 warnings/);
  });

  test('entities: get by alias, upsert, duplicate, alias_of', async () => {
    const e = await ok('get_entity', { id_or_name: 'EISS', kind: 'client' });
    assert.equal(e.name, 'Example Institute of Sample Studies');
    assert.equal((await ok('get_entity', { id_or_name: e.id })).id, e.id);

    const p = await ok('upsert_entity', { kind: 'person', name: 'Casey Example', attrs: { email: 'casey@example.com' } });
    assert.equal(p.attrs.email, 'casey@example.com');
    const dup = await err('upsert_entity', { kind: 'client', name: 'Brand New Name', aliases: ['EISS'] });
    assert.equal(dup.code, 'ENTITY_DUPLICATE');
    assert.equal(dup.details.existingId, e.id);
    assert.match(dup.hint, /alias_of/);
    const merged = await ok('upsert_entity', { kind: 'client', name: 'Example Institute', alias_of: 'EISS' });
    assert.equal(merged.id, e.id);
    assert.ok(merged.aliases.includes('Example Institute'));
    const actor = ctx.db.prepare("SELECT actor FROM audit_log WHERE action LIKE 'entity.%' ORDER BY id DESC LIMIT 1").get().actor;
    assert.equal(actor, 'mcp:demo');
  });

  test('unknown keys are refused: a misspelled documentId creates no document and uses no number', async () => {
    for (const t of (await client.listTools()).tools) assert.equal(t.inputSchema.additionalProperties, false, t.name);
    const target = await ok('generate_document', { template_id: 'debit-note', input: fixtureInput('debit-note') });
    const count = () => ctx.db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
    const counters = () => JSON.stringify(ctx.db.prepare('SELECT * FROM sequences ORDER BY scope_key').all());
    const [docsBefore, seqBefore] = [count(), counters()];
    const bad = await err('generate_document', { template_id: 'debit-note', input: fixtureInput('debit-note'), documentId: target.documentId });
    assert.equal(bad.code, 'INVALID_INPUT');
    assert.match(bad.message, /documentId/);
    assert.equal(count(), docsBefore);
    assert.equal(counters(), seqBefore);
    assert.equal((await err('list_templates', { extra: 1 })).code, 'INVALID_INPUT');
  });

  test('a negative salary is a tool error that names the row; render failures keep their message', async () => {
    const input = { ...fixtureInput('offer-letter'), earnings: [{ label: 'Basic Salary', monthly: '-10,000' }] };
    const bad = await err('generate_document', { template_id: 'offer-letter', input });
    assert.equal(bad.code, 'FIELDS_INVALID');
    assert.match(bad.message, /earnings\.0: salary amounts must not be negative/);
    const render = errorPayload(new DossierError('TEMPLATE_RENDER_FAILED', 'Template "x" could not render this input: boom', { templateId: 'x' }));
    assert.equal(render.code, 'TEMPLATE_RENDER_FAILED');
    assert.match(render.message, /boom/);
    assert.ok(render.hint.length > 0);
  });

  test('lifecycle wording comes from domain/status.js', async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'update_status');
    assert.ok(tool.description.includes(LIFECYCLE));
    assert.equal(LIFECYCLE, 'Draft -> Sent, Signed or Superseded; Sent -> Signed, Paid or Superseded; Signed -> Paid or Superseded; '
      + 'Paid -> Superseded; Superseded is final');
    assert.ok(errorPayload(new DossierError('INVALID_STATUS_TRANSITION', 'x')).hint.includes(LIFECYCLE));
  });

  test('schema violations and unknown tools come back as { code, message, hint }', async () => {
    const bad = await err('search', { q: 5 });
    assert.equal(bad.code, 'INVALID_INPUT');
    assert.match(bad.message, /q/);
    assert.equal((await err('update_status', { document_id: 'DOC-000001', status: 'Lost' })).code, 'INVALID_INPUT');
    assert.equal((await err('no_such_tool', {})).code, 'TOOL_NOT_FOUND');
  });

  test('resources: tree and document', async () => {
    const tree = await client.readResource({ uri: 'dossier://tree' });
    const root = JSON.parse(tree.contents[0].text);
    assert.equal(root.id, '');
    assert.ok(root.children.length > 0);
    const doc = await client.readResource({ uri: 'dossier://document/DOC-000001' });
    assert.equal(JSON.parse(doc.contents[0].text).id, 'DOC-000001');
    await assert.rejects(client.readResource({ uri: 'dossier://document/DOC-999999' }), /DOCUMENT_NOT_FOUND/);
    await assert.rejects(client.readResource({ uri: 'dossier://document/%E0%A4' }), /INVALID_INPUT/);
  });

  test('workspace edits on disk are picked up by the next call (clearance, brand)', async () => {
    const wsFile = join(home, 'workspace.json');
    const original = readFileSync(wsFile, 'utf8');
    const body = JSON.parse(original);
    body.users.demo.clearance = 'Public';
    writeFileSync(wsFile, JSON.stringify(body, null, 2));
    const denied = await err('preview_document', { template_id: 'debit-note', input: fixtureInput('debit-note') });
    assert.equal(denied.code, 'FORBIDDEN');
    assert.equal((await ok('list_templates')).templates.find((t) => t.id === 'debit-note').usable, false);
    assert.ok(logs.some((m) => /reloaded/.test(m)));

    // A file that no longer loads fails closed: every call is WORKSPACE_INVALID until the files load again.
    writeFileSync(wsFile, '{ broken');
    const broken = await err('search', { q: 'anything' });
    assert.equal(broken.code, 'WORKSPACE_INVALID');
    assert.equal(broken.details.file, 'workspace.json');
    assert.ok(logs.some((m) => /does not load; refusing/.test(m)));
    const logged = logs.length;
    assert.equal((await err('list_templates')).code, 'WORKSPACE_INVALID', 'still refused without a file change');
    assert.equal(logs.length, logged, 'logged once per change, not per call');
    await assert.rejects(client.readResource({ uri: 'dossier://tree' }), /WORKSPACE_INVALID/);

    writeFileSync(wsFile, original);
    const brandFile = join(home, 'brands', 'acme', 'brand.json');
    const brand = JSON.parse(readFileSync(brandFile, 'utf8'));
    brand.shortName = 'Acme Renamed';
    writeFileSync(brandFile, JSON.stringify(brand, null, 2));
    await ok('list_templates');
    assert.equal(ctx.user.clearance, 'Confidential');
    assert.equal(ctx.ws.brands.get('acme').shortName, 'Acme Renamed');
  });
});

describe('errorPayload', () => {
  test('keeps a service hint, falls back by code, hides internals', () => {
    assert.equal(errorPayload(new DossierError('STATUS_LOCKED', 'x', { hint: 'own hint' })).hint, 'own hint');
    assert.match(errorPayload(new DossierError('BRAND_NOT_FOUND', 'x')).hint, /Check the id/);
    assert.deepEqual(errorPayload(new Error('secret path /x/y')), {
      code: 'INTERNAL', message: 'Internal error', hint: errorPayload(new Error()).hint, details: {},
    });
  });
});

describe('stdio', () => {
  test('stdout carries only JSON-RPC (initialize + tools/list over a real spawn)', async () => {
    const t = tmpDir();
    try {
      const wsHome = join(t.dir, 'ws');
      initWorkspace(wsHome);
      const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', join(REPO_ROOT, 'src', 'mcp.js')], {
        env: { ...process.env, DOSSIER_HOME: wsHome, DOSSIER_USER: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const exited = new Promise((res) => child.on('exit', (code) => res(code)));
      const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
      const waitFor = async (id) => {
        for (let i = 0; i < 400; i++) {
          if (stdout.split('\n').some((l) => l.trim() && JSON.parse(l).id === id)) return;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`no response ${id}; stderr: ${stderr}`);
      };
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      await waitFor(1);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      await waitFor(2);
      child.stdin.end();
      assert.equal(await exited, 0);

      const lines = stdout.split('\n').filter((l) => l !== '');
      assert.equal(lines.length, 2);
      for (const line of lines) {
        const msg = JSON.parse(line);
        assert.equal(msg.jsonrpc, '2.0');
        assert.ok('result' in msg);
      }
      assert.equal(JSON.parse(lines[0]).result.serverInfo.name, 'dossier');
      assert.deepEqual(JSON.parse(lines[1]).result.tools.map((x) => x.name).sort(), TOOLS);
      assert.match(stderr, /serving .* as mcp \(Confidential clearance\)/);
    } finally {
      t.cleanup();
    }
  });
});
