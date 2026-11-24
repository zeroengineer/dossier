// Generator: preview drafts and generate numbered documents from templates (docs/PLAN.md B7).
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DossierError, isDossierError } from '../errors.js';
import { STATUSES } from '../domain/status.js';
import { canAccess } from '../domain/sensitivity.js';
import { displayFileName } from '../domain/naming.js';
import { extractText, htmlToText } from '../extract/index.js';
import { createPdf, finalizePdf, attachLetterhead, drawFooters, drawWatermark, renderBlocksPdf, createFormatter } from '../render/pdf/index.js';
import { blocksToHtml } from '../render/html/index.js';
import { blocksToMarkdown, fillMarkdown, parseMarkdownBlocks } from '../render/md/index.js';
import { parseSource } from '../workspace/templateSchema.js';
import { storeBlobFile } from './blobs.js';
import { addVersion, createDocument, linkDocuments, resetStatus, updateMetadata } from './documents.js';
import { requireDoc } from './documentQueries.js';
import { getEntity } from './entities.js';
import { effectiveParams, resolveTemplateFields, todayIso } from './fields.js';
import { allocateNumber, peekNumber } from './numbering.js';
import { getTemplate } from './templates.js';

/** Watermark text drawn on every page of a preview PDF. */
export const DRAFT_WATERMARK = 'DRAFT — NOT NUMBERED';
/** Text shown in place of the document number in previews. */
export const DRAFT_NUMBER = 'DRAFT';

const MIME = { pdf: 'application/pdf', html: 'text/html', md: 'text/markdown' };
/** Attempts at rendering with the peeked number before giving up (another writer took it each time). */
const MAX_NUMBER_ATTEMPTS = 3;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * JSON with object keys sorted at every level (arrays keep their order): the canonical form of an input.
 * @param {unknown} v
 * @returns {string}
 */
export function canonicalJson(v, path = 'input') {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw unsupported(path, String(v));
    return JSON.stringify(v);
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw unsupported(path, 'an invalid Date');
    return JSON.stringify(v.toISOString());
  }
  if (Array.isArray(v)) {
    return `[${v.map((x, i) => (x === undefined ? 'null' : canonicalJson(x, `${path}.${i}`))).join(',')}]`;
  }
  if (isPlainObject(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k], `${path}.${k}`)}`).join(',')}}`;
  }
  throw unsupported(path, typeof v === 'object' ? (v.constructor?.name ?? 'object') : typeof v);
}

const unsupported = (path, what) => new DossierError('INVALID_INPUT',
  `${path}: ${what} is not supported in input (use strings, numbers, booleans, null, lists and plain objects)`, { path });

function brandIdOf(ctx, brandId) {
  const id = brandId ?? ctx.ws.config.defaultBrand;
  if (!ctx.ws.brands.has(id)) throw new DossierError('BRAND_NOT_FOUND', `No brand "${id}" in the workspace`, { brandId: id });
  return id;
}

function checkClearance(ctx, meta) {
  if (!canAccess(ctx.user.clearance, meta.sensitivity)) {
    throw new DossierError('FORBIDDEN', `User "${ctx.user.id}" (${ctx.user.clearance} clearance) cannot use the ${meta.sensitivity} template "${meta.id}"`,
      { templateId: meta.id, sensitivity: meta.sensitivity, clearance: ctx.user.clearance });
  }
}

function checkInput(input) {
  if (!isPlainObject(input)) throw new DossierError('INVALID_INPUT', 'Field input must be an object');
}

/**
 * Preview token: sha256 over the template hash, the canonical JSON of the input and the brand's config hash.
 * @param {object} ctx
 * @param {string} templateId
 * @param {Record<string, unknown>} input
 * @param {{ brandId?: string, dirs?: string[] }} [opts]
 * @returns {Promise<string>}
 */
export async function previewToken(ctx, templateId, input, { brandId, dirs } = {}) {
  const template = await getTemplate(ctx, templateId, { dirs });
  return tokenOf(ctx, template, input, brandIdOf(ctx, brandId));
}

const tokenOf = (ctx, template, input, bid) => createHash('sha256')
  .update(`${template.hash}\u0000${canonicalJson(input)}\u0000${ctx.ws.brandHashes.get(bid)}`).digest('hex');

// ---------- rendering ----------

/**
 * Render a template's renditions (no database access). Templates see `values.number` (null for a draft) and `env`
 * `{ ctx, brand, meta, params, fmt, input, number, draft }`. PDF: the module's `renderPdf(pdfCtx, values, env)`, else
 * its blocks through letterhead + renderBlocksPdf + footers; a draft gets the vector watermark on every page. HTML:
 * `renderHtml(values, env)` else `blocksToHtml` (standalone). Markdown: the filled `body.md` else `blocksToMarkdown`.
 * Blocks come from `blocks(values, env)`, else from the filled body.md.
 * @param {object} ctx
 * @param {{ id: string, meta: object, module: object, body?: string }} template
 * @param {Record<string, unknown>} values resolved field values
 * @param {{ brand: object|string, number?: string|null, draft?: boolean, creationDate: Date|string, input?: object }} opts
 * @returns {Promise<Array<{ kind: 'pdf'|'html'|'md', buffer: Buffer, mime: string }>>}
 */
export async function renderRenditions(ctx, template, values, { brand, number = null, draft = false, creationDate, input = {} }) {
  const { meta, module } = template;
  const brandObj = typeof brand === 'string' ? ctx.ws.brands.get(brand) : brand;
  if (!brandObj) throw new DossierError('BRAND_NOT_FOUND', `No brand "${brand}" in the workspace`, { brandId: brand });
  const shownNumber = draft ? null : (number ?? null);
  const v = { ...values, number: shownNumber };
  const env = {
    ctx, brand: brandObj, meta, params: effectiveParams(meta, brandObj), fmt: createFormatter(ctx.ws.config.locale), input,
    number: shownNumber, draft,
  };
  const title = documentTitle(meta, values);
  const contact = meta.contact ?? 'default';

  let filledMd;
  if (template.body !== undefined) filledMd = fillMarkdown(template.body, { ...v, number: draft ? DRAFT_NUMBER : (shownNumber ?? '') }).text;
  let blocks;
  const getBlocks = () => {
    if (blocks) return blocks;
    if (typeof module.blocks === 'function') blocks = module.blocks(v, env);
    else if (filledMd !== undefined) blocks = parseMarkdownBlocks(filledMd);
    else throw new DossierError('TEMPLATE_INVALID', `Template "${meta.id}" has no blocks() and no body.md to render`, { templateId: meta.id });
    return blocks;
  };

  const out = [];
  for (const kind of meta.renditions) {
    if (kind === 'pdf') {
      const pctx = await createPdf({
        profileId: meta.layoutProfile, brand: brandObj, ws: ctx.ws, contact,
        info: { title, author: brandObj.legalName, subject: meta.title, creationDate },
      });
      if (typeof module.renderPdf === 'function') {
        await module.renderPdf(pctx, v, env);
      } else {
        await attachLetterhead(pctx);
        await renderBlocksPdf(pctx, getBlocks(), module.style, { custom: module.pdfCustom });
        drawFooters(pctx);
      }
      if (draft) drawWatermark(pctx, { text: DRAFT_WATERMARK });
      out.push({ kind, buffer: await finalizePdf(pctx), mime: MIME.pdf });
    } else if (kind === 'html') {
      const html = typeof module.renderHtml === 'function'
        ? await module.renderHtml(v, env)
        : blocksToHtml(getBlocks(), { brand: brandObj, ws: ctx.ws, title, style: module.style, standalone: true, profileId: meta.layoutProfile, contact });
      out.push({ kind, buffer: Buffer.from(String(html), 'utf8'), mime: MIME.html });
    } else if (kind === 'md') {
      const md = filledMd ?? blocksToMarkdown(getBlocks(), { brand: brandObj, contact });
      out.push({ kind, buffer: Buffer.from(md, 'utf8'), mime: MIME.md });
    }
  }
  return out;
}

// ---------- preview ----------

function writeAtomic(file, buffer) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, buffer);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Render a draft: every rendition with the number shown as "DRAFT" and a "DRAFT — NOT NUMBERED" watermark on every
 * PDF page, written to `<dataDir>/previews/<token>/preview.<ext>`. No document, number or audit row is written (the
 * template registry row is upserted as on any template load).
 * @param {object} ctx
 * @param {string} templateId
 * @param {Record<string, unknown>} [input]
 * @param {{ brandId?: string, dirs?: string[], today?: string }} [opts]
 * @returns {Promise<{ ok: false, missing: object[], errors: object[] } |
 *   { ok: true, token: string, renditions: Array<{ kind: string, path: string, bytes: number }> }>}
 */
export async function previewDocument(ctx, templateId, input = {}, { brandId, dirs, today } = {}) {
  checkInput(input);
  const template = await getTemplate(ctx, templateId, { dirs });
  checkClearance(ctx, template.meta);
  const bid = brandIdOf(ctx, brandId);
  const { values, missing, errors } = resolveTemplateFields(ctx, template, input, { brandId: bid, today });
  if (missing.length || errors.length) return { ok: false, missing, errors };
  const rendered = await renderRenditions(ctx, template, values, {
    brand: bid, draft: true, creationDate: new Date(), input,
  });
  const token = tokenOf(ctx, template, input, bid);
  const dir = join(ctx.config.dataDir, 'previews', token);
  mkdirSync(dir, { recursive: true });
  const renditions = rendered.map((r) => {
    const path = join(dir, `preview.${r.kind}`);
    writeAtomic(path, r.buffer);
    return { kind: r.kind, path, bytes: r.buffer.byteLength };
  });
  return { ok: true, token, renditions };
}

// ---------- generate ----------

/** The field holding the document's party: an entity whose kind is the template's `partyKind`. */
function partyOf(meta, values) {
  for (const f of meta.fields) {
    const src = parseSource(f.source);
    if (src.kind !== 'entity' && f.type !== 'entity') continue;
    const v = getPath(values, f.name);
    if (isPlainObject(v) && v.kind === meta.partyKind && Number.isSafeInteger(v.id)) return v;
  }
  return null;
}

function getPath(obj, path) {
  let v = obj;
  for (const part of path.split('.')) {
    if (v == null || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined;
    v = v[part];
  }
  return v;
}

/** The entity a signatory stands for: an entity-valued field, else a person entity with the brand signatory's name. */
function signatoryEntity(ctx, meta, values) {
  for (const f of meta.fields) {
    const src = parseSource(f.source);
    const v = getPath(values, f.name);
    if (!isPlainObject(v)) continue;
    if (src.kind === 'signatory' && typeof v.name === 'string') {
      try {
        return getEntity(ctx, v.name, { kind: 'person' });
      } catch (err) {
        if (isDossierError(err, 'ENTITY_NOT_FOUND')) return null;
        throw err;
      }
    }
    if (f.name === 'signatory' && Number.isSafeInteger(v.id) && typeof v.kind === 'string') return v;
  }
  return null;
}

const issuerOf = (ctx, bid) => ctx.db.prepare("SELECT id FROM entities WHERE kind = 'company' AND brand_id = ? ORDER BY id LIMIT 1").get(bid)?.id ?? null;

function documentTitle(meta, values) {
  const party = partyOf(meta, values);
  return party ? `${meta.title} - ${party.name}` : meta.title;
}

/** Series of a numbered template: `numbering.series`, or the brand's `series[templateId]` for `"brand"`. */
function seriesFor(ctx, meta, bid) {
  if (!meta.numbering) return null;
  if (meta.numbering.series !== 'brand') return meta.numbering.series;
  const sid = ctx.ws.brands.get(bid).series?.[meta.id];
  if (!sid) {
    if (meta.numbering.required === false) return null;
    throw new DossierError('SERIES_UNKNOWN', `Brand "${bid}" has no numbering series for template "${meta.id}" (brand.json series.${meta.id})`,
      { brandId: bid, templateId: meta.id });
  }
  return sid;
}

/** Pattern variables: `{CLIENT}` = the party's `attrs.code`, `{CODE}` = `values.numberCode` (else `values.code`). */
function numberVars(meta, values, bid) {
  const party = partyOf(meta, values);
  const vars = { date: values.date ?? todayIso(), brandId: bid };
  const client = party?.attrs?.code;
  if (client !== undefined && client !== null && client !== '') vars.client = String(client);
  const codeValue = values.numberCode ?? values.code;
  if (typeof codeValue === 'string' || typeof codeValue === 'number') vars.code = String(codeValue);
  return vars;
}

/**
 * Document ids named by the template's declared relations (`[{ type, field, optional }]`). The field holds one id
 * (or an object with `id`) or a list of them (e.g. a receipt paying several invoices); duplicates are linked once.
 */
function relationTargets(meta, values) {
  const out = [];
  const missing = [];
  const idOf = (x) => (isPlainObject(x) ? x.id : x);
  const blank = (x) => x === undefined || x === null || String(x).trim() === '';
  for (const r of meta.relations ?? []) {
    const v = getPath(values, r.field);
    const ids = (Array.isArray(v) ? v.map(idOf) : [idOf(v)]).filter((x) => !blank(x)).map((x) => String(x).trim());
    if (!ids.length) {
      if (!r.optional) missing.push({ name: r.field, label: r.field, type: 'document' });
      continue;
    }
    for (const to of new Set(ids)) out.push({ type: r.type, to });
  }
  return { targets: out, missing };
}

class NumberTaken extends Error {}

/** Per-database, per-series tails of the in-process generation queue (peek, render and allocate run one at a time). */
const seriesQueues = new WeakMap();

/**
 * Run `fn` after every earlier queued generation for the same database and series has settled, so generations in one
 * process never race for a number (NUMBER_CONTENDED then only comes from other processes).
 */
function inSeriesQueue(ctx, seriesId, fn) {
  if (!seriesId) return fn();
  let queues = seriesQueues.get(ctx.db);
  if (!queues) seriesQueues.set(ctx.db, (queues = new Map()));
  const prev = queues.get(seriesId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => {}, () => {});
  queues.set(seriesId, tail);
  tail.then(() => { if (queues.get(seriesId) === tail) queues.delete(seriesId); });
  return run;
}

/** Statuses a document may be created with (generateDocument without documentId). */
const CREATE_STATUSES = STATUSES.filter((s) => s !== 'Superseded');

/** Check the requested status: on create any non-Superseded status; on regenerate Draft, or the current status with force. */
function statusFor(existing, requested, force) {
  if (!existing) {
    if (requested !== undefined && !CREATE_STATUSES.includes(requested)) {
      throw new DossierError('INVALID_INPUT', `status must be one of ${CREATE_STATUSES.join(', ')}`, { status: requested });
    }
    return requested ?? 'Draft';
  }
  if (existing.status === 'Superseded') {
    throw new DossierError('INVALID_STATUS_TRANSITION', `${existing.id} is Superseded and cannot be regenerated`, { documentId: existing.id });
  }
  if (existing.status !== 'Draft' && !force) {
    throw new DossierError('STATUS_LOCKED',
      `${existing.id} is ${existing.status}; regenerating would put it back to Draft. Generate a new document and supersede this one, or pass force: true`,
      { documentId: existing.id, status: existing.status, hint: 'Generate a new document and call supersede(old, new), or regenerate with force: true' });
  }
  const allowed = force ? [...new Set(['Draft', existing.status])] : ['Draft'];
  const status = requested ?? 'Draft';
  if (!allowed.includes(status)) {
    throw new DossierError('INVALID_INPUT', `On regeneration status must be ${allowed.join(' or ')}`, { status, allowed });
  }
  return status;
}

/** Check declared relation targets: well-formed ids of existing documents the user may see, never the document itself. */
function checkRelationTargets(ctx, targets, selfId) {
  for (const t of targets) {
    const row = requireDoc(ctx, t.to);
    if (row.id === selfId) throw new DossierError('INVALID_INPUT', `A document cannot relate to itself (${t.type})`, { id: selfId, type: t.type });
  }
}

/**
 * Generate a numbered document from a template (PLAN B7). Steps: resolve fields (FIELDS_MISSING / FIELDS_INVALID) and
 * check declared relation targets; then, queued behind other generations of the same series in this process: peek the
 * next number; render every rendition with that number and `creationDate` = now; write the blob files; then in ONE
 * transaction allocate the number (re-rendering, up to 3 attempts, when another process took the peeked number
 * meanwhile, else NUMBER_CONTENDED), create the document (party, amount from `values.total`, date from `values.date`,
 * template sensitivity, issuing brand and company), add version 1 with the canonical input, link `generated_from` and
 * declared relations, and record `document_entities` (party, signatory, issuer). No number is ever allocated without a
 * stored version and no async work runs inside the transaction.
 * With `documentId`: regenerate as the next version of that document (same template and brand), keeping its number.
 * Only a Draft document can be regenerated; a Sent, Signed or Paid one is STATUS_LOCKED (supersede it instead) unless
 * `force: true`, which resets it to Draft (or keeps its current status when `status` names it) and audits the reset.
 * @param {object} ctx
 * @param {string} templateId
 * @param {Record<string, unknown>} [input]
 * @param {{ brandId?: string, status?: string, documentId?: string, force?: boolean, dirs?: string[], today?: string,
 *   note?: string }} [opts]
 * @returns {Promise<{ documentId: string, number: string|null, versionNo: number,
 *   renditions: Array<{ kind: string, sha256: string, filename: string, bytes: number }> }>}
 */
export async function generateDocument(ctx, templateId, input = {}, opts = {}) {
  checkInput(input);
  const { documentId, dirs, today, note, force = false } = opts;
  if (typeof force !== 'boolean') throw new DossierError('INVALID_INPUT', 'force must be a boolean', { force });
  const inputJson = canonicalJson(input);
  const template = await getTemplate(ctx, templateId, { dirs });
  const { meta } = template;
  checkClearance(ctx, meta);

  let existing = null;
  if (documentId !== undefined) {
    existing = requireDoc(ctx, documentId);
    if (existing.template_id !== meta.id) {
      throw new DossierError('INVALID_INPUT', `${existing.id} was not generated from template "${meta.id}"`,
        { documentId: existing.id, templateId: existing.template_id ?? null });
    }
    if (opts.brandId !== undefined && existing.issuing_brand_id && opts.brandId !== existing.issuing_brand_id) {
      throw new DossierError('INVALID_INPUT', `${existing.id} was issued by brand "${existing.issuing_brand_id}"; it cannot be regenerated for "${opts.brandId}"`,
        { documentId: existing.id, brandId: opts.brandId, issuingBrandId: existing.issuing_brand_id });
    }
  }
  const status = statusFor(existing, opts.status, force);
  const bid = brandIdOf(ctx, opts.brandId ?? existing?.issuing_brand_id ?? undefined);

  const { values, missing, errors } = resolveTemplateFields(ctx, template, input, { brandId: bid, today });
  const rel = relationTargets(meta, values);
  const allMissing = [...missing, ...rel.missing.filter((m) => !missing.some((x) => x.name === m.name))];
  if (allMissing.length) {
    throw new DossierError('FIELDS_MISSING', `Missing fields: ${allMissing.map((m) => m.name).join(', ')}`, { missing: allMissing, errors });
  }
  if (errors.length) {
    throw new DossierError('FIELDS_INVALID', `Invalid fields: ${errors.map((e) => `${e.name} (${e.message})`).join('; ')}`, { errors });
  }
  checkRelationTargets(ctx, rel.targets, existing?.id);

  const party = partyOf(meta, values);
  const signer = signatoryEntity(ctx, meta, values);
  const issuer = issuerOf(ctx, bid);
  const docDate = typeof values.date === 'string' ? values.date : null;
  const amountMinor = Number.isSafeInteger(values.total) ? values.total : null;
  const templateRef = `template:${meta.id}@${meta.version}`;
  const generatedAttrs = { templateId: meta.id, templateVersion: meta.version, templateHash: template.hash, source: template.source };
  const metadata = {
    type: meta.type,
    title: documentTitle(meta, values),
    partyId: party?.id ?? null,
    partyType: party ? meta.partyType : null,
    issuingBrandId: bid,
    issuingEntityId: issuer,
    docDate,
    amountMinor,
    currency: amountMinor === null ? null : ctx.ws.config.locale?.currencyCode ?? 'INR',
    sensitivity: meta.sensitivity,
    templateId: meta.id,
    templateVersion: meta.version,
  };
  const entities = [
    ...(party ? [{ entityId: party.id, role: 'party' }] : []),
    ...(signer ? [{ entityId: signer.id, role: 'signatory' }] : []),
    ...(issuer ? [{ entityId: issuer, role: 'issuer' }] : []),
  ];

  const seriesId = existing ? existing.number_series : seriesFor(ctx, meta, bid);
  const vars = seriesId && !existing ? numberVars(meta, values, bid) : null;

  const attemptOnce = async () => {
    const number = existing ? existing.doc_number : seriesId ? peekNumber(ctx, seriesId, vars).number : null;
    const nextVersion = existing
      ? ctx.db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM versions WHERE document_id = ?').get(existing.id).n
      : 1;
    const creationDate = new Date();
    const rendered = await renderRenditions(ctx, template, values, { brand: bid, number, draft: false, creationDate, input });
    const renditions = [];
    for (const r of rendered) {
      const extracted = r.kind === 'pdf' ? await extractText(r.buffer, { mime: r.mime })
        : { text: r.kind === 'html' ? htmlToText(r.buffer.toString('utf8')) : r.buffer.toString('utf8') };
      renditions.push({
        kind: r.kind, buffer: r.buffer, mime: r.mime, extractedText: extracted.text,
        ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
        filename: displayFileName({ date: docDate, partyName: party?.name, type: meta.type, number, version: nextVersion, ext: r.kind }),
      });
    }
    // Blob files are written before the transaction (addVersion then finds them and only inserts rows).
    for (const r of renditions) storeBlobFile(ctx, r.buffer);

    return ctx.repo.tx(() => {
      let id;
      if (existing) {
        const row = requireDoc(ctx, existing.id);
        statusFor(row, status === 'Draft' ? undefined : status, force); // the status may have moved since the check
        id = row.id;
        updateMetadata(ctx, id, { ...metadata, entities });
      } else {
        let allocated = null;
        if (seriesId) {
          allocated = allocateNumber(ctx, seriesId, vars).number;
          if (allocated !== number) throw new NumberTaken(allocated);
        }
        id = createDocument(ctx, {
          ...metadata, status, entities,
          ...(allocated ? { numberSeries: seriesId, docNumber: allocated } : {}),
        }).id;
      }
      const version = addVersion(ctx, id, { inputJson, note: note ?? null, renditions });
      if (existing) resetStatus(ctx, id, status, { reason: 'regenerate', force, versionNo: version.versionNo });
      linkDocuments(ctx, id, templateRef, 'generated_from', generatedAttrs);
      for (const t of rel.targets) linkDocuments(ctx, id, t.to, t.type);
      ctx.repo.audit('document.generate', 'document', id, existing ? { status: existing.status } : null, {
        templateId: meta.id, templateVersion: meta.version, templateHash: template.hash, brandId: bid,
        number, versionNo: version.versionNo, regenerated: Boolean(existing), status, ...(existing ? { force } : {}),
      });
      return {
        documentId: id,
        number,
        versionNo: version.versionNo,
        renditions: version.renditions.map((r) => ({ kind: r.kind, sha256: r.sha256, filename: r.filename, bytes: r.bytes })),
      };
    });
  };

  return inSeriesQueue(ctx, existing ? null : seriesId, async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await attemptOnce();
      } catch (err) {
        if (!(err instanceof NumberTaken)) throw err;
        if (attempt >= MAX_NUMBER_ATTEMPTS) {
          throw new DossierError('NUMBER_CONTENDED', `Another process kept taking the next number of series "${seriesId}"; try again`,
            { seriesId, attempts: attempt });
        }
      }
    }
  });
}
