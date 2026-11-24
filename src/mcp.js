// MCP entry: exposes search, entities, templates and generation as tools for Claude Code over stdio.
// No business logic and no SQL here: every tool calls a service. stdout carries only JSON-RPC; logs go to stderr.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { openContext, refreshWorkspace } from './context.js';
import { isDossierError } from './errors.js';
import { canAccess } from './domain/sensitivity.js';
import { STATUSES } from './domain/status.js';
import { DOCUMENT_RELATION_TYPES, ENTITY_KINDS } from './domain/enums.js';
import { search } from './services/search.js';
import { getEntity, upsertEntity } from './services/entities.js';
import { getTemplate, listTemplateErrors, listTemplates } from './services/templates.js';
import { effectiveParams, formFields, resolveFields } from './services/fields.js';
import { generateDocument, previewDocument } from './services/generator.js';
import { getDocument, linkDocuments, updateStatus } from './services/documents.js';
import { buildTree } from './services/hierarchy.js';
import { blobPath } from './services/blobs.js';

/** Default local user of the MCP process (DOSSIER_USER); an unlisted user gets the default clearance. */
export const DEFAULT_MCP_USER = 'mcp';

const VERSION = '0.1.0';

/** What to do next, by error code (a service's own `details.hint` wins). */
const HINTS = {
  INVALID_INPUT: 'Check the arguments against the tool schema and the message.',
  FIELDS_MISSING: 'Add the fields listed in details.missing to input (resolve_fields or preview_document lists them first).',
  FIELDS_INVALID: 'Fix the values listed in details.errors.',
  FORBIDDEN: 'The MCP user (DOSSIER_USER) lacks the clearance for this; a user with a higher clearance must do it.',
  STATUS_LOCKED: 'Generate a new document and link it to the old one with type "supersedes", or regenerate with force: true.',
  INVALID_STATUS_TRANSITION: 'Allowed moves: Draft -> Sent or Signed, Sent -> Signed or Paid, Signed -> Paid, any -> Superseded (final). get_document shows the current status.',
  ENTITY_DUPLICATE: 'That name already belongs to entity details.existingId: use that entity, or pass alias_of to add the name as its alias.',
  ENTITY_AMBIGUOUS: 'Pass kind to say which entity you mean (details.candidates lists them).',
  NUMBER_CONTENDED: 'Another process kept taking the next number; call generate_document again.',
  TEMPLATE_INVALID: 'The template folder is broken; list_templates reports load errors under "errors".',
  TEMPLATE_SYNTAX: 'The template body has a syntax error; fix the template folder.',
  SECRET_REJECTED: 'Keys and credentials never belong in the vault; remove them.',
  WORKSPACE_INVALID: 'Fix the workspace file named in the details, then retry.',
  TOOL_NOT_FOUND: 'Call tools/list for the available tools.',
  INTERNAL: 'Unexpected failure; the MCP server log (stderr) has the details.',
};

/**
 * The `{ code, message, hint, details }` of a thrown value: DossierErrors keep their code, message and details;
 * anything else is INTERNAL without internals.
 * @param {unknown} err
 * @returns {{ code: string, message: string, hint: string, details: Record<string, unknown> }}
 */
export function errorPayload(err) {
  if (!isDossierError(err)) {
    return { code: 'INTERNAL', message: 'Internal error', hint: HINTS.INTERNAL, details: {} };
  }
  const { code, message, details } = err.toJSON();
  const hint = typeof details?.hint === 'string' ? details.hint
    : HINTS[code] ?? (code.endsWith('_NOT_FOUND') ? 'Check the id or name; search, get_entity and list_templates find existing ones.' : 'See the message.');
  return { code, message, hint, details: details ?? {} };
}

/** A tool result carrying `data` as JSON text and as structured content. */
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });

/** A tool error result (`isError: true`) carrying `{ code, message, hint, details }`. */
const fail = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true });

/** Drop undefined values (services treat an absent option and `undefined` alike, but audit/inputs stay tidy). */
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Renditions with the absolute path of the stored file (never the bytes). Only for renditions of a document the
 * service already returned to this user (getDocument checks clearance; generateDocument checks the template's).
 */
const withPaths = (ctx, renditions) => renditions.map((r) => (r.sha256 ? { ...r, path: blobPath(ctx, r.sha256) } : r));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const warningText = (warnings) => (warnings.length ? `; ${plural(warnings.length, 'warning')} (${warnings.map((w) => w.name ?? w.code).join(', ')})` : '');

/** Document view for MCP: getDocument with file paths on every rendition. */
function documentView(ctx, id) {
  const doc = getDocument(ctx, id);
  return {
    ...doc,
    renditions: withPaths(ctx, doc.renditions),
    versions: doc.versions.map((v) => ({ ...v, renditions: withPaths(ctx, v.renditions) })),
  };
}

const status = z.enum(/** @type {[string, ...string[]]} */ ([...STATUSES]));
const stringOrList = z.union([z.string(), z.array(z.string())]);
const input = z.record(z.string(), z.unknown()).describe('Field values by field name (dotted names may be nested objects); see get_template');
const brandId = z.string().optional().describe('Issuing brand id (default: the workspace default brand)');

/**
 * Build the MCP server for one context. Before every tool call and resource read the workspace is reloaded when its
 * files changed on disk (refreshWorkspace), so saves made from the web settings apply without a restart.
 * @param {ReturnType<typeof openContext>} ctx
 * @param {{ log?: (message: string) => void }} [opts] log: diagnostics sink (default stderr)
 * @returns {McpServer}
 */
export function createMcpServer(ctx, { log = stderrLog } = {}) {
  const server = new McpServer({ name: 'dossier', version: VERSION }, {
    instructions: 'Dossier document vault: search filed documents, look up entities (clients, people, companies), and '
      + 'fill templates. To make a document: list_templates -> get_template -> resolve_fields (shows missing fields) -> '
      + 'preview_document (draft files, no number used) -> generate_document (allocates the number, files the document).',
  });

  const refresh = () => {
    const r = refreshWorkspace(ctx);
    if (r.reloaded) log('workspace changed on disk; reloaded');
    if (r.error) log(`workspace changed on disk but does not load; keeping the previous version: ${r.error.message}`);
  };

  /** Wrap a handler: refresh the workspace, run it, map errors to `{ code, message, hint }`. */
  const tool = (fn) => async (args) => {
    try {
      refresh();
      return ok(await fn(args ?? {}));
    } catch (err) {
      if (!isDossierError(err)) log(`tool failed: ${err?.stack ?? err}`);
      return fail(errorPayload(err));
    }
  };

  // Input that fails the schema, or an unknown tool, is reported by the SDK through createToolError: give it the
  // same `{ code, message, hint }` shape as every other error.
  server.createToolError = (message) => {
    const code = /Tool \S+ (not found|disabled)/.test(message) ? 'TOOL_NOT_FOUND' : 'INVALID_INPUT';
    return fail({ code, message, hint: HINTS[code], details: {} });
  };

  server.registerTool('search', {
    title: 'Search documents',
    description: 'Search filed documents by number, title, party names/aliases and extracted text. Returns ranked hits '
      + '(document summary, match kind, snippet), related documents one hop away, and matching entities. Only documents '
      + 'within the MCP user\'s clearance are returned.',
    inputSchema: {
      q: z.string().describe('Words to find (all must match), or a document number / id'),
      types: stringOrList.optional().describe('Document type(s), e.g. "Invoice"'),
      status: z.union([status, z.array(status)]).optional().describe('Status filter'),
      limit: z.number().int().min(1).max(200).optional().describe('Max hits (default 20)'),
    },
  }, tool(({ q, types, status: st, limit }) => search(ctx, defined({ q, types, status: st, limit }))));

  server.registerTool('get_entity', {
    title: 'Get entity',
    description: 'One entity of the master list (client, person, company, vendor, product, engagement…) by id, name or '
      + 'alias, with aliases, attributes, relations and the number of documents referencing it.',
    inputSchema: {
      id_or_name: z.union([z.string(), z.number().int()]).describe('Entity id, or a name or alias'),
      kind: z.enum(/** @type {[string, ...string[]]} */ ([...ENTITY_KINDS])).optional().describe('Restrict a name lookup to one kind'),
    },
  }, tool(({ id_or_name: ref, kind }) => getEntity(ctx, ref, defined({ kind }))));

  server.registerTool('upsert_entity', {
    title: 'Create or update entity',
    description: 'Create an entity, or update the one of the same kind and name: aliases are added (never removed), '
      + 'attrs are merged (null deletes a key). A name or alias already used by another entity is ENTITY_DUPLICATE; '
      + 'pass alias_of (that entity\'s id or name) to add the name and aliases as aliases of it instead.',
    inputSchema: {
      kind: z.enum(/** @type {[string, ...string[]]} */ ([...ENTITY_KINDS])),
      name: z.string(),
      aliases: z.array(z.string()).optional(),
      attrs: z.record(z.string(), z.unknown()).optional().describe('e.g. { "address": ["line 1", "line 2"], "email": "…" }'),
      alias_of: z.union([z.string(), z.number().int()]).optional().describe('Existing entity (id or name) to add these names to'),
    },
  }, tool(({ kind, name, aliases, attrs, alias_of: aliasOf }) => upsertEntity(ctx, defined({ kind, name, aliases, attrs, aliasOf }))));

  server.registerTool('list_templates', {
    title: 'List templates',
    description: 'Every document template (id, type, title, category, sensitivity, renditions, numbering). `usable` is '
      + 'false when the template is above the MCP user\'s clearance. `errors` lists template folders that failed to load.',
    inputSchema: {},
  }, tool(() => ({
    templates: listTemplates(ctx).map((t) => ({
      id: t.id, version: t.version, type: t.type, title: t.title, category: t.category, source: t.source,
      description: t.meta.description ?? null, sensitivity: t.meta.sensitivity, renditions: t.meta.renditions,
      numbering: t.meta.numbering ?? null, usable: canAccess(ctx.user.clearance, t.meta.sensitivity),
    })),
    errors: listTemplateErrors(ctx),
  })));

  server.registerTool('get_template', {
    title: 'Get template',
    description: 'One template: the fields to fill (name, label, type, required, help, choices, row keys of lists), '
      + 'effective params for the brand, numbering and renditions.',
    inputSchema: { id: z.string(), brand_id: brandId },
  }, tool(async ({ id, brand_id: bid }) => {
    const t = await getTemplate(ctx, id);
    const fields = formFields(ctx, t, defined({ brandId: bid }));
    const { meta } = t;
    return {
      id: t.id, version: meta.version, type: meta.type, title: meta.title, description: meta.description ?? null,
      category: meta.category, sensitivity: meta.sensitivity, usable: canAccess(ctx.user.clearance, meta.sensitivity),
      source: t.source, hash: t.hash, renditions: meta.renditions, numbering: meta.numbering ?? null,
      fields, params: effectiveParams(meta, ctx.ws.brands.get(bid ?? ctx.ws.config.defaultBrand)),
    };
  }));

  server.registerTool('resolve_fields', {
    title: 'Resolve fields',
    description: 'Fill a template\'s fields from input, entities, brand and defaults without rendering. Returns the '
      + 'resolved values, `missing` required fields and `errors` (bad values, unknown entities).',
    inputSchema: { template_id: z.string(), input, brand_id: brandId },
  }, tool(({ template_id: tid, input: inp, brand_id: bid }) => resolveFields(ctx, tid, inp, defined({ brandId: bid }))));

  server.registerTool('preview_document', {
    title: 'Preview document',
    description: 'Render a draft (number shown as DRAFT, watermarked) to files and return their paths, sizes and '
      + 'warnings (placeholders that printed empty). Nothing is filed and no number is used. With missing or invalid '
      + 'fields returns ok: false with `missing` and `errors`.',
    inputSchema: { template_id: z.string(), input, brand_id: brandId },
  }, tool(async ({ template_id: tid, input: inp, brand_id: bid }) => {
    const r = await previewDocument(ctx, tid, inp, defined({ brandId: bid }));
    if (!r.ok) {
      return {
        ok: false, missing: r.missing, errors: r.errors,
        summary: `Not rendered: ${plural(r.missing.length, 'missing field')}, ${plural(r.errors.length, 'invalid value')}`,
      };
    }
    const warnings = r.warnings ?? [];
    return {
      ok: true, token: r.token,
      renditions: r.renditions.map(({ kind, path, bytes }) => ({ kind, path, bytes })),
      warnings,
      summary: `Draft ${tid} rendered: ${r.renditions.map((x) => `${x.kind} (${x.bytes} bytes)`).join(', ')}${warningText(warnings)}`,
    };
  }));

  server.registerTool('generate_document', {
    title: 'Generate document',
    description: 'Render and file a document: allocates the next number of its series, stores every rendition and '
      + 'returns the document id, number, version, file paths and warnings. With document_id, regenerates that '
      + 'document as its next version (keeps its number); a Sent, Signed or Paid document needs force: true.',
    inputSchema: {
      template_id: z.string(),
      input,
      brand_id: brandId,
      status: status.optional().describe('Initial status (default Draft)'),
      document_id: z.string().optional().describe('Regenerate this document (DOC-000001) instead of creating one'),
      force: z.boolean().optional().describe('With document_id: allow regenerating a Sent/Signed/Paid document'),
      note: z.string().optional().describe('Version note'),
    },
  }, tool(async (a) => {
    const r = await generateDocument(ctx, a.template_id, a.input, defined({
      brandId: a.brand_id, status: a.status, documentId: a.document_id, force: a.force, note: a.note,
    }));
    const warnings = r.warnings ?? [];
    return {
      ...r,
      renditions: withPaths(ctx, r.renditions),
      warnings,
      summary: `${a.document_id ? 'Regenerated' : 'Generated'} ${r.documentId}${r.number ? ` (${r.number})` : ''} version ${r.versionNo}`
        + `: ${r.renditions.map((x) => x.kind).join(', ')}${warningText(warnings)}`,
    };
  }));

  server.registerTool('link_documents', {
    title: 'Link documents',
    description: 'Relate two documents: from_id --type--> to_id (e.g. a receipt "pays" an invoice, a new document '
      + '"supersedes" an old one).',
    inputSchema: {
      from_id: z.string(),
      to_id: z.string(),
      type: z.enum(/** @type {[string, ...string[]]} */ ([...DOCUMENT_RELATION_TYPES])),
    },
  }, tool(({ from_id: from, to_id: to, type }) => linkDocuments(ctx, from, to, type)));

  server.registerTool('update_status', {
    title: 'Update status',
    description: 'Move a document along its lifecycle: Draft -> Sent or Signed, Sent -> Signed or Paid, Signed -> Paid, any -> Superseded (final).',
    inputSchema: { document_id: z.string(), status },
  }, tool(({ document_id: id, status: st }) => updateStatus(ctx, id, st)));

  server.registerTool('get_document', {
    title: 'Get document',
    description: 'Full metadata of one document: party, number, dates, amount, status, versions with renditions '
      + '(file paths, not bytes), related entities and related documents.',
    inputSchema: { id: z.string().describe('Document id, e.g. DOC-000001') },
  }, tool(({ id }) => documentView(ctx, id)));

  /** Resource reads share the refresh and turn errors into readable JSON. */
  const resource = (uri, fn) => {
    try {
      refresh();
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(fn(), null, 2) }] };
    } catch (err) {
      if (!isDossierError(err)) log(`resource failed: ${err?.stack ?? err}`);
      const e = errorPayload(err);
      throw Object.assign(new Error(`${e.code}: ${e.message}`), { data: e });
    }
  };

  server.registerResource('tree', 'dossier://tree', {
    title: 'Folder tree',
    description: 'The vault folder tree (documents within the MCP user\'s clearance)',
    mimeType: 'application/json',
  }, (uri) => resource(uri.href, () => buildTree(ctx)));

  server.registerResource('document', new ResourceTemplate('dossier://document/{id}', { list: undefined }), {
    title: 'Document',
    description: 'Full metadata of one document (same as get_document)',
    mimeType: 'application/json',
  }, (uri, { id }) => resource(uri.href, () => documentView(ctx, decodeURIComponent(String(id)))));

  return server;
}

/** @param {string} message */
function stderrLog(message) {
  process.stderr.write(`dossier-mcp: ${message}\n`);
}

/**
 * Open the workspace from the environment (DOSSIER_HOME, DOSSIER_USER default `mcp`) and serve MCP over stdio until
 * stdin closes. Audit rows are written as `mcp:<user>`.
 * @param {{ env?: Record<string, string|undefined> }} [opts]
 * @returns {Promise<{ server: McpServer, ctx: ReturnType<typeof openContext> }>}
 */
export async function main({ env = process.env } = {}) {
  // stdout belongs to the protocol: anything a dependency prints goes to stderr.
  for (const m of ['log', 'info', 'debug']) console[m] = (...a) => console.error(...a);
  const config = loadConfig(env);
  const user = env.DOSSIER_USER || DEFAULT_MCP_USER;
  const ctx = openContext({ home: config.home, user, actor: `mcp:${user}`, env });
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  let closed = false;
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    await server.close().catch(() => {});
    ctx.close();
  };
  transport.onclose = () => { shutdown(); };
  process.stdin.once('end', () => { shutdown().then(() => process.exit(0)); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { shutdown().then(() => process.exit(0)); });
  await server.connect(transport);
  stderrLog(`serving ${config.home} as ${user} (${ctx.user.clearance} clearance)`);
  return { server, ctx };
}

const runDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (runDirectly) {
  main().catch((err) => {
    stderrLog(`cannot start: ${err?.message ?? err}`);
    stderrLog('set DOSSIER_HOME to a workspace folder (see docs/MCP.md)');
    process.exitCode = 1;
  });
}
