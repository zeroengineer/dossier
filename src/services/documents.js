import { DossierError } from '../errors.js';
import { nowIso } from '../db/index.js';
import { STATUSES, assertTransition } from '../domain/status.js';
import { LEVELS, canAccess } from '../domain/sensitivity.js';
import { secretReason } from '../domain/secrets.js';
import { recordBlob, storeBlobFile } from './blobs.js';
import { reindexDocument } from './searchIndex.js';
import { assertSeries, registerExisting } from './numbering.js';
import {
  DOCUMENT_ENTITY_ROLES, DOCUMENT_RELATION_TYPES, PARTY_TYPES, RENDITION_KINDS,
  checkDocId, docRow, documentEntities, getDocument, invalid, requireDoc, rowSnapshot, versionView,
} from './documentQueries.js';

export { getDocument, listDocuments, readRendition, readBlobForUser, RENDITION_KINDS, DOCUMENT_RELATION_TYPES, DOCUMENT_ENTITY_ROLES, PARTY_TYPES } from './documentQueries.js';

/** Event emitted (after commit) whenever documents, versions, renditions or relations change. Payload: `{ ids: string[] }`. */
export const DOCUMENT_CHANGED = 'document:changed';

/** Party type implied by an entity kind (used when `partyType` is not given). */
const PARTY_TYPE_OF_KIND = {
  company: 'Company', group_entity: 'GroupEntity', person: 'Person', client: 'Client', vendor: 'Vendor', product: 'Product',
};

const DEFAULT_MIME = { pdf: 'application/pdf', html: 'text/html', md: 'text/markdown', original: 'application/octet-stream' };

/** camelCase metadata field -> documents column. */
const COLUMNS = {
  type: 'type', title: 'title', partyId: 'party_id', partyType: 'party_type', businessLineId: 'business_line_id',
  engagementId: 'engagement_id', issuingEntityId: 'issuing_entity_id', issuingBrandId: 'issuing_brand_id',
  numberSeries: 'number_series', docNumber: 'doc_number', docDate: 'doc_date', dueDate: 'due_date',
  amountMinor: 'amount_minor', currency: 'currency', sensitivity: 'sensitivity', templateId: 'template_id',
  templateVersion: 'template_version',
};

// ---------- validation ----------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function optString(v, what) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.trim() === '') throw invalid(`${what} must be a non-empty string`, { [what]: v });
  return v.trim();
}

function optDate(v, what) {
  if (v === undefined || v === null) return null;
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  const ok = d !== null && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  if (!ok) throw invalid(`${what} must be a date YYYY-MM-DD`, { [what]: v });
  return v;
}

function optPositiveInt(v, what) {
  if (v === undefined || v === null) return null;
  if (!Number.isSafeInteger(v) || v <= 0) throw invalid(`${what} must be a positive integer`, { [what]: v });
  return v;
}

function optEntity(ctx, v, what, kind) {
  const id = optPositiveInt(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v, what);
  if (id === null) return null;
  const e = ctx.db.prepare('SELECT id, kind FROM entities WHERE id = ?').get(id);
  if (!e) throw new DossierError('ENTITY_NOT_FOUND', `${what}: no entity ${id}`, { [what]: id });
  if (kind && e.kind !== kind) throw invalid(`${what} must be a ${kind} entity (entity ${id} is a ${e.kind})`, { [what]: id, kind: e.kind });
  return e;
}

/**
 * Validate a full set of metadata fields (camelCase) and return the column values. A party without a
 * `partyType` gets the type implied by its entity kind.
 */
function toColumns(ctx, f) {
  const type = optString(f.type, 'type');
  if (!type) throw invalid('type is required', { type: f.type });
  if (f.title !== undefined && f.title !== null && typeof f.title !== 'string') throw invalid('title must be a string', { title: f.title });

  const party = optEntity(ctx, f.partyId, 'partyId');
  let partyType = f.partyType ?? null;
  if (!party && partyType !== null) throw invalid('partyType needs a partyId', { partyType });
  if (party && partyType === null) partyType = PARTY_TYPE_OF_KIND[party.kind] ?? null;
  if (partyType !== null && !PARTY_TYPES.includes(partyType)) throw invalid(`Unknown party type "${partyType}" (expected one of ${PARTY_TYPES.join(', ')})`, { partyType });
  if (party && partyType === null) throw invalid(`partyType is required for a ${party.kind} party`, { partyId: party.id });

  const brand = optString(f.issuingBrandId, 'issuingBrandId');
  if (brand && !ctx.db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brand)) {
    throw new DossierError('BRAND_NOT_FOUND', `No brand "${brand}" in the workspace`, { issuingBrandId: brand });
  }

  const amount = f.amountMinor ?? null;
  if (amount !== null && !Number.isSafeInteger(amount)) throw invalid('amountMinor must be an integer (minor units)', { amountMinor: amount });
  const currency = f.currency ?? null;
  if (currency !== null && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))) throw invalid('currency must be a 3-letter ISO code like INR', { currency });
  if (amount !== null && currency === null) throw invalid('currency is required with amountMinor', { amountMinor: amount });

  const sensitivity = f.sensitivity ?? 'Internal';
  if (!LEVELS.includes(sensitivity)) throw invalid(`Unknown sensitivity "${sensitivity}" (expected one of ${LEVELS.join(', ')})`, { sensitivity });
  if (!canAccess(ctx.user.clearance, sensitivity)) {
    throw new DossierError('FORBIDDEN', `User "${ctx.user.id}" (${ctx.user.clearance} clearance) cannot file a ${sensitivity} document`,
      { sensitivity, clearance: ctx.user.clearance });
  }

  return {
    type,
    title: f.title ?? '',
    party_id: party?.id ?? null,
    party_type: partyType,
    business_line_id: optEntity(ctx, f.businessLineId, 'businessLineId', 'business_line')?.id ?? null,
    engagement_id: optEntity(ctx, f.engagementId, 'engagementId', 'engagement')?.id ?? null,
    issuing_entity_id: optEntity(ctx, f.issuingEntityId, 'issuingEntityId')?.id ?? null,
    issuing_brand_id: brand,
    number_series: optString(f.numberSeries, 'numberSeries'),
    doc_number: optString(f.docNumber, 'docNumber'),
    doc_date: optDate(f.docDate, 'docDate'),
    due_date: optDate(f.dueDate, 'dueDate'),
    amount_minor: amount,
    currency,
    sensitivity,
    template_id: optString(f.templateId, 'templateId'),
    template_version: optPositiveInt(f.templateVersion, 'templateVersion'),
  };
}

function checkEntityLinks(ctx, list) {
  if (!Array.isArray(list)) throw invalid('entities must be an array of { entityId, role }', { entities: list });
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!isPlainObject(item)) throw invalid('entities must be an array of { entityId, role }', { entities: list });
    const e = optEntity(ctx, item.entityId, 'entityId');
    if (!e) throw invalid('entityId is required', { item });
    if (!DOCUMENT_ENTITY_ROLES.includes(item.role)) throw invalid(`Unknown role "${item.role}" (expected one of ${DOCUMENT_ENTITY_ROLES.join(', ')})`, { role: item.role });
    const key = `${e.id}|${item.role}`;
    if (!seen.has(key)) out.push({ entityId: e.id, role: item.role });
    seen.add(key);
  }
  return out;
}

function checkUnknownKeys(obj, allowed, what) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw invalid(`Unknown ${what} field "${key}"`, { field: key });
  }
}

// ---------- write helpers ----------

/** Ids of other documents holding the same number in the same series. */
function numberConflicts(ctx, series, number, exceptId) {
  if (!series || !number) return [];
  return ctx.db.prepare('SELECT id FROM documents WHERE number_series = ? AND doc_number = ? AND id <> ? ORDER BY id')
    .all(series, number, exceptId ?? '').map((r) => r.id);
}

function warnConflict(ctx, id, series, number, conflictsWith) {
  ctx.repo.audit('document.number_conflict', 'document', id, null,
    { warning: `Number ${number} is already used in series ${series}`, numberSeries: series, docNumber: number, conflictsWith });
}

/**
 * Seed the series counter past a number set by hand (upload, import, metadata edit) so the generator never issues it
 * again (forward only). A number that does not follow the series pattern, or whose scope cannot be worked out, is
 * stored as given and seeds nothing. Runs inside the caller's transaction.
 */
function seedFromNumber(ctx, cols) {
  if (!cols.number_series || !cols.doc_number) return;
  try {
    registerExisting(ctx, cols.number_series, cols.doc_number, {
      ...(cols.issuing_brand_id ? { brandId: cols.issuing_brand_id } : {}), ...(cols.doc_date ? { date: cols.doc_date } : {}),
    });
  } catch (err) {
    if (!(err instanceof DossierError)) throw err;
  }
}

function snapshot(ctx, id) {
  return { ...rowSnapshot(docRow(ctx, id)), entities: documentEntities(ctx, id).map((e) => ({ entityId: e.id, role: e.role })) };
}

/** Record a document write (inside its transaction): refresh the search rows, bump table versions, queue the event. */
function changed(ctx, ids, tables = ['documents']) {
  const unique = [...new Set(ids)];
  for (const id of unique) reindexDocument(ctx, id);
  for (const t of [...tables, 'search_index']) ctx.repo.bump(t);
  ctx.repo.emitAfterCommit(DOCUMENT_CHANGED, { ids: unique });
}

const touch = (ctx, id) => ctx.db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(nowIso(), id);

function writeEntities(ctx, id, links) {
  ctx.db.prepare('DELETE FROM document_entities WHERE document_id = ?').run(id);
  const ins = ctx.db.prepare('INSERT INTO document_entities (document_id, entity_id, role) VALUES (?, ?, ?)');
  for (const l of links) ins.run(id, l.entityId, l.role);
}

// ---------- create / update ----------

const CREATE_FIELDS = [...Object.keys(COLUMNS), 'status', 'entities'];

/**
 * Create a document (metadata only; files arrive with addVersion). Allocates `DOC-000001`-style ids.
 * A `docNumber` already used in the same `numberSeries` is stored with `numberConflict: true` and a
 * `document.number_conflict` audit warning instead of failing (legacy reuse, rule B5.3). `numberSeries` must exist in
 * series.json (SERIES_UNKNOWN); a number that follows its pattern seeds the counter past it, so it is never generated.
 * `partyType` is inferred from the party entity's kind when left out.
 * @param {object} ctx
 * @param {{ type: string, title?: string, partyId?: number, partyType?: string, businessLineId?: number,
 *   engagementId?: number, issuingEntityId?: number, issuingBrandId?: string, numberSeries?: string, docNumber?: string,
 *   docDate?: string, dueDate?: string, amountMinor?: number, currency?: string, status?: string, sensitivity?: string,
 *   templateId?: string, templateVersion?: number, entities?: { entityId: number, role: string }[] }} meta
 *   status defaults to Draft, sensitivity to Internal (must not exceed the user's clearance)
 * @returns {object} the document as returned by getDocument
 */
export function createDocument(ctx, meta) {
  if (!isPlainObject(meta)) throw invalid('createDocument needs a metadata object');
  checkUnknownKeys(meta, CREATE_FIELDS, 'document');
  const cols = toColumns(ctx, meta);
  const status = meta.status ?? 'Draft';
  if (!STATUSES.includes(status)) throw invalid(`Unknown status "${status}" (expected one of ${STATUSES.join(', ')})`, { status });
  const links = checkEntityLinks(ctx, meta.entities ?? []);
  if (cols.number_series) assertSeries(ctx, cols.number_series);

  const id = ctx.repo.tx(() => {
    const newId = ctx.repo.nextDocumentId();
    const conflicts = numberConflicts(ctx, cols.number_series, cols.doc_number, newId);
    const row = { id: newId, ...cols, number_conflict: conflicts.length ? 1 : 0, status, created_by: ctx.user.id };
    const names = Object.keys(row);
    ctx.db.prepare(`INSERT INTO documents (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...Object.values(row));
    writeEntities(ctx, newId, links);
    ctx.repo.audit('document.create', 'document', newId, null, snapshot(ctx, newId));
    if (conflicts.length) warnConflict(ctx, newId, cols.number_series, cols.doc_number, conflicts);
    seedFromNumber(ctx, cols);
    changed(ctx, [newId], ['documents', 'document_entities']);
    return newId;
  });
  return getDocument(ctx, id);
}

/**
 * Change metadata fields (any createDocument field except `status`; use updateStatus). `entities`, when given,
 * replaces the document's entity links. Fields set to null are cleared. Audited with before/after; a no-op patch
 * writes nothing. Changing the series or number re-evaluates the conflict flag (a series must exist in series.json,
 * else SERIES_UNKNOWN) and seeds the series counter past the new number. The result carries
 * `warnings: ['NUMBER_CONFLICT']` when this edit gave the document a number another document of the series holds.
 * @param {object} ctx
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @returns {object} the document as returned by getDocument, plus `warnings: string[]`
 */
export function updateMetadata(ctx, id, patch) {
  if (!isPlainObject(patch)) throw invalid('updateMetadata needs a patch object');
  if (Object.hasOwn(patch, 'status')) throw invalid('Use updateStatus (or supersede) to change status', { field: 'status' });
  checkUnknownKeys(patch, [...Object.keys(COLUMNS), 'entities'], 'document');
  let conflicted = false;
  ctx.repo.tx(() => {
    const row = requireDoc(ctx, id);
    const before = snapshot(ctx, row.id);
    const merged = { ...rowSnapshot(row), ...patch };
    // A new party without an explicit type gets the type implied by its kind.
    const partyChanged = Object.hasOwn(patch, 'partyId') && patch.partyId !== row.party_id;
    if (partyChanged && !Object.hasOwn(patch, 'partyType')) merged.partyType = null;
    const cols = toColumns(ctx, merged);

    const numberChanged = cols.number_series !== row.number_series || cols.doc_number !== row.doc_number;
    if (cols.number_series && cols.number_series !== row.number_series) assertSeries(ctx, cols.number_series);
    const conflicts = numberChanged ? numberConflicts(ctx, cols.number_series, cols.doc_number, row.id) : [];
    const sets = { ...cols, ...(numberChanged ? { number_conflict: conflicts.length ? 1 : 0 } : {}) };
    const diff = Object.entries(sets).filter(([k, v]) => row[k] !== v);
    if (diff.length) {
      ctx.db.prepare(`UPDATE documents SET ${diff.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...diff.map(([, v]) => v), nowIso(), row.id);
    }
    if (patch.entities !== undefined) writeEntities(ctx, row.id, checkEntityLinks(ctx, patch.entities ?? []));
    const after = snapshot(ctx, row.id);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (!diff.length) touch(ctx, row.id);
    ctx.repo.audit('document.update', 'document', row.id, before, after);
    if (conflicts.length) warnConflict(ctx, row.id, cols.number_series, cols.doc_number, conflicts);
    if (numberChanged) seedFromNumber(ctx, cols);
    changed(ctx, [row.id], ['documents', 'document_entities']);
    conflicted = conflicts.length > 0;
  });
  return { ...getDocument(ctx, id), warnings: conflicted ? ['NUMBER_CONFLICT'] : [] };
}

// ---------- versions ----------

function checkRenditions(list) {
  if (!Array.isArray(list) || list.length === 0) throw invalid('A version needs at least one rendition', { renditions: list });
  const kinds = new Set();
  return list.map((r, i) => {
    if (!isPlainObject(r)) throw invalid(`renditions[${i}] must be an object`, { index: i });
    if (!RENDITION_KINDS.includes(r.kind)) throw invalid(`Unknown rendition kind "${r.kind}" (expected one of ${RENDITION_KINDS.join(', ')})`, { index: i, kind: r.kind });
    if (kinds.has(r.kind)) throw invalid(`Two ${r.kind} renditions in one version`, { kind: r.kind });
    kinds.add(r.kind);
    if (!(r.buffer instanceof Uint8Array)) throw invalid(`renditions[${i}].buffer must be a Buffer`, { index: i });
    if (typeof r.filename !== 'string' || r.filename.trim() === '') throw invalid(`renditions[${i}].filename is required`, { index: i });
    if (r.mime !== undefined && r.mime !== null && (typeof r.mime !== 'string' || r.mime === '')) throw invalid(`renditions[${i}].mime must be a string`, { index: i });
    if (r.extractedText !== undefined && r.extractedText !== null && typeof r.extractedText !== 'string') throw invalid(`renditions[${i}].extractedText must be a string`, { index: i });
    if (r.pageCount !== undefined && r.pageCount !== null && (!Number.isSafeInteger(r.pageCount) || r.pageCount < 0)) throw invalid(`renditions[${i}].pageCount must be a non-negative integer`, { index: i });
    const reason = secretReason({ filename: r.filename, buffer: r.buffer, text: r.extractedText });
    if (reason) {
      throw new DossierError('SECRET_REJECTED',
        `"${r.filename}" looks like a key or credential (${reason}). Keep secrets in a password manager, not the vault.`,
        { filename: r.filename, reason });
    }
    return { ...r, filename: r.filename.trim(), mime: r.mime ?? DEFAULT_MIME[r.kind] };
  });
}

function inputJsonOf(input) {
  if (input === undefined || input === null) return null;
  if (typeof input === 'string') {
    try { JSON.parse(input); } catch { throw invalid('inputJson must be valid JSON', {}); }
    return input;
  }
  return JSON.stringify(input);
}

function makeCurrent(ctx, documentId, versionId) {
  ctx.db.prepare('UPDATE versions SET is_current = 0 WHERE document_id = ? AND is_current = 1').run(documentId);
  ctx.db.prepare('UPDATE versions SET is_current = 1 WHERE id = ?').run(versionId);
  ctx.db.prepare('UPDATE documents SET current_version_id = ?, updated_at = ? WHERE id = ?').run(versionId, nowIso(), documentId);
}

/**
 * Add a version with its renditions. Each rendition's bytes are stored once by sha256 (storeBlobFile + recordBlob). Files that look
 * like secrets (`.pem`, `.key`, `.env`, PEM armour or "PRIVATE KEY" in the bytes or extracted text) are refused
 * with SECRET_REJECTED before anything is stored. Blob files are written before the transaction; only rows are
 * inserted inside it. When the document has no current version the new one becomes current regardless of
 * `makeCurrent`. Renditions are never modified afterwards: a changed file
 * (e.g. a stamped `original`) is a new version (rule B5.7).
 * @param {object} ctx
 * @param {string} documentId
 * @param {{ inputJson?: object|string, note?: string, makeCurrent?: boolean,
 *   renditions: { kind: 'pdf'|'html'|'md'|'original', buffer: Buffer, filename: string, mime?: string,
 *     extractedText?: string, pageCount?: number }[] }} spec
 * @returns {import('./documentQueries.js').VersionView}
 */
export function addVersion(ctx, documentId, spec) {
  if (!isPlainObject(spec)) throw invalid('addVersion needs { renditions }');
  checkUnknownKeys(spec, ['inputJson', 'note', 'renditions', 'makeCurrent'], 'version');
  const { inputJson, note = null, makeCurrent: current = true } = spec;
  if (note !== null && typeof note !== 'string') throw invalid('note must be a string', { note });
  if (typeof current !== 'boolean') throw invalid('makeCurrent must be a boolean', { makeCurrent: current });
  requireDoc(ctx, documentId);
  const renditions = checkRenditions(spec.renditions);
  const input = inputJsonOf(inputJson);
  // File IO happens before the transaction so the shared write lock is never held while writing bytes.
  const files = renditions.map((r) => storeBlobFile(ctx, r.buffer));

  const versionId = ctx.repo.tx(() => {
    const row = requireDoc(ctx, documentId);
    const no = ctx.db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM versions WHERE document_id = ?').get(row.id).n;
    const vid = Number(ctx.db.prepare('INSERT INTO versions (document_id, version_no, is_current, note, input_json, created_by) VALUES (?, ?, 0, ?, ?, ?)')
      .run(row.id, no, note, input, ctx.user.id).lastInsertRowid);
    const stored = [];
    for (const [i, r] of renditions.entries()) {
      const blob = recordBlob(ctx, { ...files[i], mime: r.mime });
      const rid = Number(ctx.db.prepare('INSERT INTO renditions (version_id, kind, blob_sha256, filename, mime, bytes, page_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(vid, r.kind, blob.sha256, r.filename, r.mime, blob.bytes, r.pageCount ?? null).lastInsertRowid);
      if (typeof r.extractedText === 'string') ctx.db.prepare('INSERT INTO document_text (rendition_id, text) VALUES (?, ?)').run(rid, r.extractedText);
      stored.push({ kind: r.kind, sha256: blob.sha256, bytes: blob.bytes, filename: r.filename, reused: !blob.created });
    }
    // A document without a current version always takes the new one, whatever makeCurrent says.
    if (current || row.current_version_id === null) makeCurrent(ctx, row.id, vid);
    else touch(ctx, row.id);
    const isCurrent = current || row.current_version_id === null;
    ctx.repo.audit('document.version.add', 'document', row.id, null, { versionNo: no, current: isCurrent, note, renditions: stored });
    changed(ctx, [row.id], ['documents', 'versions', 'renditions', 'document_text']);
    return vid;
  });
  const row = docRow(ctx, documentId);
  return versionView(ctx, row, ctx.db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId));
}

/**
 * Make version `versionNo` the current one (exactly one current version per document).
 * @param {object} ctx
 * @param {string} documentId
 * @param {number} versionNo
 * @returns {object} the document as returned by getDocument
 */
export function setCurrentVersion(ctx, documentId, versionNo) {
  if (!Number.isSafeInteger(versionNo) || versionNo < 1) throw invalid('versionNo must be a positive integer', { versionNo });
  ctx.repo.tx(() => {
    const row = requireDoc(ctx, documentId);
    const v = ctx.db.prepare('SELECT id, version_no FROM versions WHERE document_id = ? AND version_no = ?').get(row.id, versionNo);
    if (!v) throw new DossierError('VERSION_NOT_FOUND', `${row.id} has no version ${versionNo}`, { id: row.id, versionNo });
    if (row.current_version_id === v.id) return;
    const prev = row.current_version_id === null ? null
      : ctx.db.prepare('SELECT version_no FROM versions WHERE id = ?').get(row.current_version_id).version_no;
    makeCurrent(ctx, row.id, v.id);
    ctx.repo.audit('document.version.set_current', 'document', row.id, { currentVersion: prev }, { currentVersion: versionNo });
    changed(ctx, [row.id], ['documents', 'versions']);
  });
  return getDocument(ctx, documentId);
}

// ---------- status ----------

function setStatus(ctx, row, to, action, extra = {}) {
  assertTransition(row.status, to);
  ctx.db.prepare('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?').run(to, nowIso(), row.id);
  ctx.repo.audit(action, 'document', row.id, { status: row.status }, { status: to, ...extra });
}

/**
 * Move a document along its lifecycle (see domain/status.js). Setting the current status again is a no-op.
 * @param {object} ctx
 * @param {string} id
 * @param {string} status
 * @returns {object} the document as returned by getDocument; throws INVALID_STATUS_TRANSITION
 */
export function updateStatus(ctx, id, status) {
  ctx.repo.tx(() => {
    const row = requireDoc(ctx, id);
    if (row.status === status) return;
    setStatus(ctx, row, status, 'document.status');
    changed(ctx, [row.id]);
  });
  return getDocument(ctx, id);
}

/**
 * Put a document back to `status` without the lifecycle rules, for the generator: a regenerated document is new
 * content, so it returns to Draft (or the status the caller names). A Superseded document stays Superseded
 * (INVALID_STATUS_TRANSITION) and `Superseded` is never set here. Audited as `document.status` with `extra`.
 * Joins the caller's transaction.
 * @param {object} ctx
 * @param {string} id
 * @param {string} status
 * @param {Record<string, unknown>} [extra] added to the audit `after` (e.g. `{ reason: 'regenerate' }`)
 */
export function resetStatus(ctx, id, status, extra = {}) {
  if (!STATUSES.includes(status) || status === 'Superseded') {
    throw invalid(`status must be one of ${STATUSES.filter((s) => s !== 'Superseded').join(', ')}`, { status });
  }
  ctx.repo.tx(() => {
    const row = requireDoc(ctx, id);
    if (row.status === 'Superseded') {
      throw new DossierError('INVALID_STATUS_TRANSITION', `${row.id} is Superseded`, { from: row.status, to: status, allowed: [] });
    }
    if (row.status === status) return;
    ctx.db.prepare('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), row.id);
    ctx.repo.audit('document.status', 'document', row.id, { status: row.status }, { status, ...extra });
    changed(ctx, [row.id]);
  });
}

/**
 * Supersede `oldId` by `newId`: the old document becomes `Superseded` and a `supersedes` relation new -> old is
 * recorded (rule B5.2).
 * @param {object} ctx
 * @param {string} oldId
 * @param {string} newId
 * @returns {object} the old document as returned by getDocument
 */
export function supersede(ctx, oldId, newId) {
  if (checkDocId(oldId) === checkDocId(newId)) throw invalid('A document cannot supersede itself', { id: oldId });
  ctx.repo.tx(() => {
    const oldRow = requireDoc(ctx, oldId);
    const newRow = requireDoc(ctx, newId);
    setStatus(ctx, oldRow, 'Superseded', 'document.supersede', { supersededBy: newRow.id });
    ctx.db.prepare("INSERT INTO document_relations (from_doc, to_doc, type) VALUES (?, ?, 'supersedes') ON CONFLICT DO NOTHING").run(newRow.id, oldRow.id);
    changed(ctx, [oldRow.id, newRow.id], ['documents', 'document_relations']);
  });
  return getDocument(ctx, oldId);
}

// ---------- relations ----------

const TEMPLATE_REF = /^template:[^@\s]+@\d+$/;

function checkRelation(ctx, fromId, toId, type) {
  if (!DOCUMENT_RELATION_TYPES.includes(type)) throw invalid(`Unknown relation type "${type}" (expected one of ${DOCUMENT_RELATION_TYPES.join(', ')})`, { type });
  const from = requireDoc(ctx, fromId);
  if (type === 'generated_from') {
    if (typeof toId !== 'string' || !TEMPLATE_REF.test(toId)) throw invalid('generated_from points at a template as "template:<id>@<version>"', { to: toId });
  } else {
    if (checkDocId(toId) === from.id) throw invalid('A document cannot relate to itself', { id: from.id });
    requireDoc(ctx, toId);
  }
  return from;
}

const relationView = (r) => ({ id: r.id, from: r.from_doc, to: r.to_doc, type: r.type, attrs: JSON.parse(r.attrs) });
const relationRow = (ctx, from, to, type) => ctx.db.prepare('SELECT * FROM document_relations WHERE from_doc = ? AND to_doc = ? AND type = ?').get(from, to, type);

/**
 * Relate two documents (`fromId --type--> toId`), or a document to a template for `generated_from`
 * (`toId` = `template:<id>@<version>`). Linking again with other attrs replaces them; linking again with the
 * same attrs changes nothing.
 * @param {object} ctx
 * @param {string} fromId
 * @param {string} toId
 * @param {string} type
 * @param {Record<string, unknown>} [attrs]
 * @returns {{ id: number, from: string, to: string, type: string, attrs: Record<string, unknown> }}
 */
export function linkDocuments(ctx, fromId, toId, type, attrs = {}) {
  if (!isPlainObject(attrs)) throw invalid('attrs must be an object', { attrs });
  return ctx.repo.tx(() => {
    const from = checkRelation(ctx, fromId, toId, type);
    const existing = relationRow(ctx, from.id, toId, type);
    const json = JSON.stringify(attrs);
    if (existing && existing.attrs === json) return relationView(existing);
    if (existing) ctx.db.prepare('UPDATE document_relations SET attrs = ? WHERE id = ?').run(json, existing.id);
    else ctx.db.prepare('INSERT INTO document_relations (from_doc, to_doc, type, attrs) VALUES (?, ?, ?, ?)').run(from.id, toId, type, json);
    const after = relationView(relationRow(ctx, from.id, toId, type));
    ctx.repo.audit('document.link', 'document', from.id, existing ? relationView(existing) : null, after);
    changed(ctx, type === 'generated_from' ? [from.id] : [from.id, toId], ['document_relations']);
    return after;
  });
}

/**
 * Remove a relation. Returns false when it did not exist.
 * @param {object} ctx
 * @param {string} fromId
 * @param {string} toId
 * @param {string} type
 * @returns {boolean}
 */
export function unlinkDocuments(ctx, fromId, toId, type) {
  return ctx.repo.tx(() => {
    const from = checkRelation(ctx, fromId, toId, type);
    const existing = relationRow(ctx, from.id, toId, type);
    if (!existing) return false;
    ctx.db.prepare('DELETE FROM document_relations WHERE id = ?').run(existing.id);
    ctx.repo.audit('document.unlink', 'document', from.id, relationView(existing), null);
    changed(ctx, type === 'generated_from' ? [from.id] : [from.id, toId], ['document_relations']);
    return true;
  });
}

