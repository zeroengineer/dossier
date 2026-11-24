import { extname } from 'node:path';
import { DossierError } from '../errors.js';
import { memoOf, WS } from '../cache/memo.js';
import { accessibleLevels, canAccess } from '../domain/sensitivity.js';
import { displayFileName } from '../domain/naming.js';
import { PARTY_TOP, TOP_KEYS, financialYear, idSegment, leafIn, routeFor, routingConfig } from '../domain/routing.js';

/** Folder for client documents with no business line (neither on the document nor on the client). */
export const UNASSIGNED = 'Unassigned';
/** Engagement folder for a multi-engagement client's documents that carry no engagement. */
export const GENERAL = 'General';
/** Financial-year folder for finance documents without a document date. */
export const UNDATED = 'Undated';

/**
 * @typedef {{ id: string, displayName: string, type: string, status: string, sensitivity: string, docDate: string|null }} TreeDocument
 * @typedef {{ id: string, name: string, path: string, children: TreeNode[], documents: TreeDocument[] }} TreeNode
 * @typedef {{ id: string, type: string, status: string, sensitivity: string, docDate?: string|null,
 *   displayName: string, party?: { id: number, name: string, type: string }|null,
 *   businessLine?: { id: number, name: string }|null, engagement?: { id: number, name: string }|null }} TreeItem
 *   One document as the pure builder sees it. `businessLine` is already resolved (document value, else the client's
 *   `belongs_to_business_line` relation).
 */

const topIndex = (key) => TOP_KEYS.indexOf(key);
const named = (name) => ({ key: `n:${name}`, name });
const entity = (e) => ({ key: `e:${e.id}`, name: e.name, entityId: e.id });

/**
 * Folder segments (below the top level) and the top-level slot for one document.
 * @returns {{ top: string, segments: { key: string, name: string, entityId?: number }[], clientId?: number }}
 */
function place(item, cfg) {
  if (item.sensitivity === 'Restricted') return { top: 'restricted', segments: [] };
  const route = routeFor(item.type, cfg);
  const party = item.party && PARTY_TOP[item.party.type] ? item.party : null;
  const top = route.top ?? (party ? PARTY_TOP[party.type] : 'company');
  const leafName = route.override ? route.leaf : leafIn(top, route.leaf);
  const leaf = leafName ? [named(leafName)] : [];
  if (top === 'finance') return { top, segments: [named(financialYear(item.docDate) ?? UNDATED), ...leaf] };
  if (route.top || top === 'company') return { top, segments: leaf };
  if (top === 'clients') {
    const bl = item.businessLine ? entity(item.businessLine) : named(UNASSIGNED);
    return { top, segments: [bl, entity(party), ...leaf], clientId: party.id };
  }
  return { top, segments: [entity(party), ...leaf] };
}

function newNode(name) {
  return { id: '', name, path: '', children: [], documents: [], index: new Map() };
}

/** Sort children by name, give every node its path and a stable id (sibling slug clashes get the entity id). */
function finish(node, parentId, parentPath) {
  const children = [...node.index.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key));
  // The plain slug goes to a named (non-entity) folder if one has it, else to the lowest entity id; later entities
  // with the same slug get `-<entity id>`, so creating an entity never renames an existing node.
  const owner = new Map();
  for (const c of children) {
    const seg = idSegment(c.name);
    const cur = owner.get(seg);
    const rank = (x) => (x.entityId === undefined ? -1 : x.entityId);
    if (!cur || rank(c) < rank(cur)) owner.set(seg, c);
  }
  const used = new Set();
  node.children = children.map((c) => {
    let seg = idSegment(c.name);
    if (owner.get(seg) !== c && c.entityId !== undefined) seg = `${seg}-${c.entityId}`;
    for (let n = 2; used.has(seg); n++) seg = `${idSegment(c.name)}-${n}`;
    used.add(seg);
    c.node.id = `${parentId}/${seg}`;
    c.node.path = `${parentPath}/${c.name}`;
    return finish(c.node, c.node.id, c.node.path);
  });
  node.documents.sort((a, b) => a.displayName.localeCompare(b.displayName, 'en') || a.id.localeCompare(b.id));
  delete node.index;
  return node;
}

/**
 * Build the folder tree from document metadata (pure; no database). Every top-level folder is present (the
 * Restricted one only for users cleared for Restricted); documents above `clearance` are left out. Clients are
 * grouped business line -> client -> engagement -> leaf, with the engagement level only when the client's visible
 * documents span more than one engagement (documents without one then go to "General").
 * @param {TreeItem[]} items
 * @param {{ hierarchy?: { topLevel?: string[], routing?: Record<string, string> }, clearance: string }} opts
 * @returns {TreeNode} the root node (id '', name '') whose children are the top-level folders
 */
export function assembleTree(items, { hierarchy, clearance }) {
  const cfg = routingConfig(hierarchy);
  const seeRestricted = canAccess(clearance, 'Restricted');
  const placed = items.filter((it) => canAccess(clearance, it.sensitivity)).map((it) => ({ it, ...place(it, cfg) }));

  const engagements = new Map();
  for (const p of placed) {
    if (p.clientId === undefined || !p.it.engagement) continue;
    if (!engagements.has(p.clientId)) engagements.set(p.clientId, new Set());
    engagements.get(p.clientId).add(p.it.engagement.id);
  }

  const root = { id: '', name: '', path: '', children: [], documents: [] };
  const tops = new Map();
  TOP_KEYS.forEach((key, i) => {
    if (key === 'restricted' && !seeRestricted) return;
    const node = newNode(cfg.topLevel[i]);
    node.id = String(i + 1).padStart(2, '0');
    node.path = cfg.topLevel[i];
    tops.set(key, node);
  });

  for (const p of placed) {
    const segments = [...p.segments];
    if (p.clientId !== undefined && (engagements.get(p.clientId)?.size ?? 0) > 1) {
      segments.splice(2, 0, p.it.engagement ? entity(p.it.engagement) : named(GENERAL));
    }
    let node = tops.get(p.top);
    for (const s of segments) {
      if (!node.index.has(s.key)) node.index.set(s.key, { ...s, node: newNode(s.name) });
      node = node.index.get(s.key).node;
    }
    node.documents.push({
      id: p.it.id, displayName: p.it.displayName, type: p.it.type, status: p.it.status, sensitivity: p.it.sensitivity,
      docDate: p.it.docDate ?? null,
    });
  }

  root.children = [...tops.entries()].sort((a, b) => topIndex(a[0]) - topIndex(b[0])).map(([, n]) => finish(n, n.id, n.path));
  return root;
}

const RENDITION_PREFERENCE = ['pdf', 'original', 'html', 'md'];

/** Visible documents as TreeItems (one query for documents, one for current renditions, one for business lines). */
function loadItems(ctx) {
  const rows = ctx.db.prepare(
    'SELECT d.id, d.type, d.status, d.sensitivity, d.doc_date, d.doc_number, d.party_id, d.party_type, d.current_version_id, '
    + 'p.display_name AS party_name, d.business_line_id, bl.display_name AS bl_name, d.engagement_id, en.display_name AS eng_name, '
    + 'v.version_no FROM documents d '
    + 'LEFT JOIN entities p ON p.id = d.party_id LEFT JOIN entities bl ON bl.id = d.business_line_id '
    + 'LEFT JOIN entities en ON en.id = d.engagement_id LEFT JOIN versions v ON v.id = d.current_version_id '
    + 'WHERE d.sensitivity IN (SELECT value FROM json_each(?)) ORDER BY d.id',
  ).all(JSON.stringify(accessibleLevels(ctx.user.clearance)));

  const renditions = new Map();
  for (const r of ctx.db.prepare(
    'SELECT r.version_id, r.kind, r.filename FROM renditions r JOIN documents d ON d.current_version_id = r.version_id',
  ).all()) {
    if (!renditions.has(r.version_id)) renditions.set(r.version_id, new Map());
    renditions.get(r.version_id).set(r.kind, r.filename);
  }

  const clientLine = new Map();
  for (const r of ctx.db.prepare(
    "SELECT r.from_id, e.id, e.display_name FROM entity_relations r JOIN entities e ON e.id = r.to_id "
    + "WHERE r.role = 'belongs_to_business_line' ORDER BY e.display_name, e.id",
  ).all()) {
    if (!clientLine.has(r.from_id)) clientLine.set(r.from_id, { id: r.id, name: r.display_name });
  }

  return rows.map((r) => {
    const kinds = renditions.get(r.current_version_id) ?? new Map();
    const kind = RENDITION_PREFERENCE.find((k) => kinds.has(k));
    const ext = kind === 'original' ? extname(kinds.get(kind)) : kind;
    const party = r.party_id === null ? null : { id: r.party_id, name: r.party_name, type: r.party_type };
    let businessLine = r.business_line_id === null ? null : { id: r.business_line_id, name: r.bl_name };
    if (!businessLine && party?.type === 'Client') businessLine = clientLine.get(party.id) ?? null;
    return {
      id: r.id, type: r.type, status: r.status, sensitivity: r.sensitivity, docDate: r.doc_date,
      displayName: displayFileName({ date: r.doc_date, partyName: r.party_name, type: r.type, number: r.doc_number, version: r.version_no, ext }),
      party, businessLine,
      engagement: r.engagement_id === null ? null : { id: r.engagement_id, name: r.eng_name },
    };
  });
}

/**
 * The folder tree as a view over metadata (PLAN B3), for the acting user's clearance. Memoised per context and
 * clearance until one of its tables is written (or another process writes, see cache/memo.js).
 * @param {object} ctx
 * @returns {TreeNode} root node; its children are the top-level folders in configured order
 */
export function buildTree(ctx) {
  const clearance = ctx.user.clearance;
  return structuredClone(memoOf(ctx)(`tree\u0000${clearance}`, TREE_DEPS,
    () => assembleTree(loadItems(ctx), { hierarchy: ctx.ws.config.hierarchy, clearance })));
}

/** Tables the tree is built from (memo dependencies), plus the workspace configuration (hierarchy settings). */
const TREE_DEPS = ['documents', 'entities', 'document_entities', 'entity_relations', 'versions', 'renditions', WS];

/**
 * Find a node by id in a tree.
 * @param {TreeNode} tree
 * @param {string} nodeId
 * @returns {TreeNode|null}
 */
export function findNode(tree, nodeId) {
  if (tree.id === nodeId) return tree;
  for (const c of tree.children) {
    if (nodeId === c.id || nodeId.startsWith(`${c.id}/`)) return findNode(c, nodeId);
  }
  return null;
}

/**
 * One node of the tree (with its subtree). `''` is the root.
 * @param {object} ctx
 * @param {string} nodeId e.g. `03/events/demo-retail-llp/invoices-and-receipts`
 * @returns {TreeNode} throws NODE_NOT_FOUND
 */
export function getNode(ctx, nodeId) {
  const id = String(nodeId ?? '').replace(/^\/+|\/+$/g, '');
  const node = findNode(buildTree(ctx), id);
  if (!node) throw new DossierError('NODE_NOT_FOUND', `No folder ${id}`, { id });
  return node;
}
