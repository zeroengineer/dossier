import { extname } from 'node:path';
import { DossierError } from '../errors.js';
import { STATUSES } from '../domain/status.js';
import { LEVELS, accessibleLevels, assertAccess, canAccess } from '../domain/sensitivity.js';
import { displayFileName } from '../domain/naming.js';
import { readBlob } from './blobs.js';
import { DOCUMENT_ENTITY_ROLES, DOCUMENT_RELATION_TYPES, PARTY_TYPES, RENDITION_KINDS } from '../domain/enums.js';

// Re-exported for existing importers; defined in src/domain/enums.js.
export { DOCUMENT_ENTITY_ROLES, DOCUMENT_RELATION_TYPES, PARTY_TYPES, RENDITION_KINDS };

const MAX_LIMIT = 500;
const TEMPLATE_REF = /^template:([^@\s]+)@(\d+)$/;

/**
 * @typedef {{ id: number, kind: string, sha256: string, bytes: number, mime: string, filename: string,
 *   displayName: string, pageCount: number|null, createdAt: string }} RenditionView
 * @typedef {{ id: number, versionNo: number, isCurrent: boolean, note: string|null, input: unknown,
 *   createdBy: string|null, createdAt: string, renditions: RenditionView[] }} VersionView
 * @typedef {{ id: string, type: string, title: string, status: string, sensitivity: string,
 *   party: { id: number, kind: string, name: string, type: string }|null, docNumber: string|null,
 *   numberSeries: string|null, numberConflict: boolean, docDate: string|null, dueDate: string|null,
 *   amountMinor: number|null, currency: string|null, currentVersion: number|null, updatedAt: string }} DocumentSummary
 */

export const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);

/**
 * Validate a document id (`DOC-000001`); returns it.
 * @param {unknown} id
 * @returns {string}
 */
export function checkDocId(id) {
  if (typeof id !== 'string' || !/^DOC-\d{6,}$/.test(id)) throw invalid('A document id looks like DOC-000001', { id });
  return id;
}

/** The documents row, or null. */
export const docRow = (ctx, id) => ctx.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) ?? null;

/**
 * The documents row of `id`, checked against the user's clearance.
 * @returns {object} throws DOCUMENT_NOT_FOUND or FORBIDDEN
 */
export function requireDoc(ctx, id) {
  const row = docRow(ctx, checkDocId(id));
  if (!row) throw new DossierError('DOCUMENT_NOT_FOUND', `No document ${id}`, { id });
  assertAccess(ctx, row);
  return row;
}

const entityRef = (ctx, id) => {
  if (id === null || id === undefined) return null;
  const e = ctx.db.prepare('SELECT id, kind, display_name FROM entities WHERE id = ?').get(id);
  return e ? { id: e.id, kind: e.kind, name: e.display_name } : null;
};

/** Plain metadata of a row (camelCase, ids only): the before/after shape written to the audit log. */
export function rowSnapshot(row) {
  return {
    id: row.id, type: row.type, title: row.title, partyId: row.party_id, partyType: row.party_type,
    businessLineId: row.business_line_id, engagementId: row.engagement_id, issuingEntityId: row.issuing_entity_id,
    issuingBrandId: row.issuing_brand_id, numberSeries: row.number_series, docNumber: row.doc_number,
    numberConflict: row.number_conflict === 1, docDate: row.doc_date, dueDate: row.due_date,
    amountMinor: row.amount_minor, currency: row.currency, status: row.status, sensitivity: row.sensitivity,
    templateId: row.template_id, templateVersion: row.template_version,
  };
}

/** Document–entity links of a document, ordered. */
export function documentEntities(ctx, id) {
  return ctx.db.prepare(
    'SELECT de.entity_id, de.role, e.kind, e.display_name FROM document_entities de JOIN entities e ON e.id = de.entity_id '
    + 'WHERE de.document_id = ? ORDER BY de.role, e.display_name, e.id',
  ).all(id).map((r) => ({ id: r.entity_id, kind: r.kind, name: r.display_name, role: r.role }));
}

function renditionsOf(ctx, row, versionId, versionNo) {
  const party = entityRef(ctx, row.party_id);
  return ctx.db.prepare('SELECT * FROM renditions WHERE version_id = ? ORDER BY id').all(versionId).map((r) => ({
    id: r.id,
    kind: r.kind,
    sha256: r.blob_sha256,
    bytes: r.bytes,
    mime: r.mime,
    filename: r.filename,
    displayName: displayFileName({
      date: row.doc_date, partyName: party?.name, type: row.type, number: row.doc_number, version: versionNo,
      ext: r.kind === 'original' ? extname(r.filename) : r.kind,
    }),
    pageCount: r.page_count ?? null,
    createdAt: r.created_at,
  }));
}

/**
 * One version with its renditions.
 * @returns {VersionView}
 */
export function versionView(ctx, row, v) {
  return {
    id: v.id,
    versionNo: v.version_no,
    isCurrent: v.is_current === 1,
    note: v.note ?? null,
    input: v.input_json === null || v.input_json === undefined ? null : JSON.parse(v.input_json),
    createdBy: v.created_by ?? null,
    createdAt: v.created_at,
    renditions: renditionsOf(ctx, row, v.id, v.version_no),
  };
}

function currentVersionNo(ctx, row) {
  if (row.current_version_id === null) return null;
  return ctx.db.prepare('SELECT version_no FROM versions WHERE id = ?').get(row.current_version_id)?.version_no ?? null;
}

/** @returns {DocumentSummary} */
export function summaryOf(ctx, row) {
  const party = entityRef(ctx, row.party_id);
  return {
    id: row.id, type: row.type, title: row.title, status: row.status, sensitivity: row.sensitivity,
    party: party ? { ...party, type: row.party_type } : null,
    docNumber: row.doc_number, numberSeries: row.number_series, numberConflict: row.number_conflict === 1,
    docDate: row.doc_date, dueDate: row.due_date, amountMinor: row.amount_minor, currency: row.currency,
    currentVersion: currentVersionNo(ctx, row), updatedAt: row.updated_at,
  };
}

/** Relations in both directions; document ends the user may not see are left out. */
function relationsOf(ctx, id) {
  const rows = ctx.db.prepare(
    "SELECT id, from_doc, to_doc, type, attrs, 'out' AS direction FROM document_relations WHERE from_doc = :id "
    + "UNION ALL SELECT id, from_doc, to_doc, type, attrs, 'in' AS direction FROM document_relations WHERE to_doc = :id ORDER BY id",
  ).all({ id });
  const out = [];
  for (const r of rows) {
    const otherId = r.direction === 'out' ? r.to_doc : r.from_doc;
    const tpl = TEMPLATE_REF.exec(otherId);
    let document = null;
    if (!tpl) {
      const other = docRow(ctx, otherId);
      if (!other || !canAccess(ctx.user.clearance, other.sensitivity)) continue;
      document = { id: other.id, type: other.type, title: other.title, docNumber: other.doc_number, status: other.status };
    }
    out.push({
      id: r.id, type: r.type, direction: r.direction, document,
      template: tpl ? { id: tpl[1], version: Number(tpl[2]) } : null,
      attrs: JSON.parse(r.attrs),
    });
  }
  return out;
}

/**
 * Full metadata of one document (PLAN B4): party and party type, business line, engagement, issuing entity and
 * brand, number (+ conflict flag), dates, amount, status, sensitivity, template id/version, every version with its
 * renditions (sha256, bytes, filename, display name), the current renditions, related entities with roles and
 * related documents in both directions with relation types.
 * @param {object} ctx
 * @param {string} id `DOC-000001`
 * @returns {object} throws DOCUMENT_NOT_FOUND, or FORBIDDEN when the document is above the user's clearance
 */
export function getDocument(ctx, id) {
  const row = requireDoc(ctx, id);
  const versions = ctx.db.prepare('SELECT * FROM versions WHERE document_id = ? ORDER BY version_no').all(row.id)
    .map((v) => versionView(ctx, row, v));
  const current = versions.find((v) => v.isCurrent) ?? null;
  const summary = summaryOf(ctx, row);
  return {
    ...summary,
    businessLine: entityRef(ctx, row.business_line_id),
    engagement: entityRef(ctx, row.engagement_id),
    issuingEntity: entityRef(ctx, row.issuing_entity_id),
    issuingBrandId: row.issuing_brand_id,
    template: row.template_id ? { id: row.template_id, version: row.template_version } : null,
    renditions: current?.renditions ?? [],
    versions,
    entities: documentEntities(ctx, row.id),
    relations: relationsOf(ctx, row.id),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const FILTERS = {
  type: (v) => ({ sql: 'd.type = :type', v: str(v, 'type') }),
  status: (v) => {
    if (!STATUSES.includes(v)) throw invalid(`Unknown status "${v}"`, { status: v });
    return { sql: 'd.status = :status', v };
  },
  sensitivity: (v) => {
    if (!LEVELS.includes(v)) throw invalid(`Unknown sensitivity "${v}"`, { sensitivity: v });
    return { sql: 'd.sensitivity = :sensitivity', v };
  },
  partyId: (v) => ({ sql: 'd.party_id = :partyId', v: int(v, 'partyId') }),
  businessLineId: (v) => ({ sql: 'd.business_line_id = :businessLineId', v: int(v, 'businessLineId') }),
  engagementId: (v) => ({ sql: 'd.engagement_id = :engagementId', v: int(v, 'engagementId') }),
  issuingBrandId: (v) => ({ sql: 'd.issuing_brand_id = :issuingBrandId', v: str(v, 'issuingBrandId') }),
  numberSeries: (v) => ({ sql: 'd.number_series = :numberSeries', v: str(v, 'numberSeries') }),
  docNumber: (v) => ({ sql: 'd.doc_number = :docNumber', v: str(v, 'docNumber') }),
  from: (v) => ({ sql: 'd.doc_date >= :from', v: str(v, 'from') }),
  to: (v) => ({ sql: 'd.doc_date <= :to', v: str(v, 'to') }),
};

function str(v, what) {
  if (typeof v !== 'string' || v === '') throw invalid(`${what} must be a non-empty string`, { [what]: v });
  return v;
}
function int(v, what) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw invalid(`${what} must be a positive integer`, { [what]: v });
  return n;
}

/**
 * List documents the user may see (sensitivity at or below their clearance), newest document date first.
 * @param {object} ctx
 * @param {{ type?: string, status?: string, sensitivity?: string, partyId?: number, businessLineId?: number,
 *   engagementId?: number, issuingBrandId?: string, numberSeries?: string, docNumber?: string,
 *   from?: string, to?: string, limit?: number, offset?: number }} [filters] `from`/`to` bound `docDate` (inclusive);
 *   undefined/null filters are ignored; limit 1..500 (default 50)
 * @returns {DocumentSummary[]}
 */
export function listDocuments(ctx, filters = {}) {
  const { limit = 50, offset = 0, ...rest } = filters ?? {};
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw invalid(`limit must be an integer from 1 to ${MAX_LIMIT}`, { limit });
  if (!Number.isSafeInteger(offset) || offset < 0) throw invalid('offset must be a non-negative integer', { offset });
  const { where, params } = listWhere(ctx, rest);
  const rows = ctx.db.prepare(
    `SELECT d.* FROM documents d WHERE ${where} `
    + 'ORDER BY d.doc_date IS NULL, d.doc_date DESC, d.id DESC LIMIT :limit OFFSET :offset',
  ).all({ ...params, limit, offset });
  return rows.map((r) => summaryOf(ctx, r));
}

/**
 * Count the documents `listDocuments` would return for the same filters without paging (for "page N of M").
 * `limit` and `offset` are ignored; every other filter is validated exactly as in `listDocuments`.
 * @param {object} ctx
 * @param {Parameters<typeof listDocuments>[1]} [filters]
 * @returns {number}
 */
export function countDocuments(ctx, filters = {}) {
  const { limit: _limit, offset: _offset, ...rest } = filters ?? {};
  const { where, params } = listWhere(ctx, rest);
  return ctx.db.prepare(`SELECT COUNT(*) AS n FROM documents d WHERE ${where}`).get(params).n;
}

/** WHERE clause (clearance + FILTERS) shared by listDocuments and countDocuments. */
function listWhere(ctx, filters) {
  const where = ['d.sensitivity IN (SELECT value FROM json_each(:levels))'];
  const params = { levels: JSON.stringify(accessibleLevels(ctx.user.clearance)) };
  for (const [key, value] of Object.entries(filters)) {
    if (!Object.hasOwn(FILTERS, key)) throw invalid(`Unknown filter "${key}" (expected one of ${Object.keys(FILTERS).join(', ')})`, { filter: key });
    if (value === undefined || value === null) continue;
    const f = FILTERS[key](value);
    where.push(f.sql);
    params[key] = f.v;
  }
  return { where: where.join(' AND '), params };
}

/**
 * Read one rendition's bytes, gated by the document's sensitivity (the only file read for request handlers).
 * @param {object} ctx
 * @param {string} documentId
 * @param {{ versionNo?: number, kind: 'pdf'|'html'|'md'|'original' }} opts versionNo defaults to the current version
 * @returns {{ buffer: Buffer, filename: string, mime: string, sha256: string, bytes: number }}
 *   throws DOCUMENT_NOT_FOUND, FORBIDDEN, VERSION_NOT_FOUND or RENDITION_NOT_FOUND
 */
export function readRendition(ctx, documentId, { versionNo, kind } = {}) {
  if (!RENDITION_KINDS.includes(kind)) throw invalid(`Unknown rendition kind "${kind}" (expected one of ${RENDITION_KINDS.join(', ')})`, { kind });
  if (versionNo !== undefined && versionNo !== null && (!Number.isSafeInteger(versionNo) || versionNo < 1)) {
    throw invalid('versionNo must be a positive integer', { versionNo });
  }
  const row = requireDoc(ctx, documentId);
  const v = versionNo === undefined || versionNo === null
    ? (row.current_version_id === null ? null : ctx.db.prepare('SELECT id, version_no FROM versions WHERE id = ?').get(row.current_version_id))
    : ctx.db.prepare('SELECT id, version_no FROM versions WHERE document_id = ? AND version_no = ?').get(row.id, versionNo);
  if (!v) {
    throw new DossierError('VERSION_NOT_FOUND', versionNo ? `${row.id} has no version ${versionNo}` : `${row.id} has no current version`,
      { id: row.id, versionNo: versionNo ?? null });
  }
  const r = ctx.db.prepare('SELECT * FROM renditions WHERE version_id = ? AND kind = ?').get(v.id, kind);
  if (!r) throw new DossierError('RENDITION_NOT_FOUND', `${row.id} version ${v.version_no} has no ${kind} rendition`, { id: row.id, versionNo: v.version_no, kind });
  return { buffer: readBlob(ctx, r.blob_sha256), filename: r.filename, mime: r.mime, sha256: r.blob_sha256, bytes: r.bytes };
}

/**
 * Read a stored file by its sha256 for the acting user: the bytes are served through a rendition of a document the
 * user may see (readRendition), never straight from the blob store. When several renditions share the blob, the one
 * whose file name equals `filename` is preferred (its mime and name are returned), then the newest.
 * @param {object} ctx
 * @param {string} sha256 64 lowercase hex characters
 * @param {{ filename?: string }} [opts]
 * @returns {ReturnType<typeof readRendition> & { documentId: string, versionNo: number, kind: string }}
 *   throws INVALID_INPUT for a malformed sha256, BLOB_NOT_FOUND when no rendition uses it, FORBIDDEN when every
 *   document using it is above the user's clearance
 */
export function readBlobForUser(ctx, sha256, { filename } = {}) {
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw invalid('A blob id is a lowercase sha256 hex string', { sha256 });
  const rows = ctx.db.prepare(
    'SELECT r.kind, r.filename, v.version_no, d.id AS document_id, d.sensitivity FROM renditions r '
    + 'JOIN versions v ON v.id = r.version_id JOIN documents d ON d.id = v.document_id '
    + 'WHERE r.blob_sha256 = ? ORDER BY r.id DESC',
  ).all(sha256);
  if (rows.length === 0) throw new DossierError('BLOB_NOT_FOUND', `No stored file ${sha256}`, { sha256 });
  const visible = rows.filter((r) => canAccess(ctx.user.clearance, r.sensitivity));
  if (visible.length === 0) {
    throw new DossierError('FORBIDDEN', `User "${ctx.user.id}" (${ctx.user.clearance} clearance) may not read this file`,
      { sha256, clearance: ctx.user.clearance });
  }
  const pick = visible.find((r) => r.filename === filename) ?? visible[0];
  const out = readRendition(ctx, pick.document_id, { versionNo: pick.version_no, kind: pick.kind });
  return { ...out, documentId: pick.document_id, versionNo: pick.version_no, kind: pick.kind };
}
