import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { DossierError } from '../errors.js';
import { normaliseName } from '../domain/canonical.js';
import { findNumbers } from '../domain/numbering.js';
import { IDENTITY_TYPES, findTextDate, hasKeyword, plausibleDate, textType, typeKeywordTable, wordsOf } from '../domain/doctypes.js';
import { DEFAULT_LEAF, DEFAULT_ROUTES, LEAF_MAP, TOP_KEYS, TOP_LEAVES, TOP_LEVEL, leafIn, routingConfig } from '../domain/routing.js';
import { secretReason } from '../domain/secrets.js';
import { LEVELS, canAccess } from '../domain/sensitivity.js';
import { extractText } from '../extract/index.js';
import { findEntities, relateEntities, upsertEntity, getEntity } from './entities.js';
import { registerExisting } from './numbering.js';
import { peekTemplates } from './templates.js';
import { uploadFile } from './upload.js';

/**
 * Legacy import (PLAN build step 22): register an existing document folder, or the files listed in an index CSV,
 * into the vault. Source files are only read, never changed, moved or deleted.
 *
 * Classification uses the folder path below the import root: the top-level folder ("03 Clients", or legacy names
 * such as "04 Products" or "06 Vendors - Invoices Received", matched on the name after the number) selects the party
 * kind; the leaf folder selects the document type through the routing table read backwards; folder names between
 * them become entities (business line / client / engagement, person, vendor, product, group entity). Nothing about
 * any organisation is hard-coded: names come from the folders and the workspace.
 */

/** Default sensitivity per kind of folder; override with `opts.sensitivity`. */
export const DEFAULT_IMPORT_SENSITIVITY = Object.freeze({ default: 'Internal', people: 'Confidential', identity: 'Confidential' });

/** Folder names that hold identity documents (passports, ID cards, KYC); override with `opts.identityPattern`. */
export const IDENTITY_FOLDER_RE = /\bidentity\b|\bkyc\b/i;

/** Folder names (after the number prefix) that always hold the legacy generator's source code. */
const GENERATOR_SOURCE_RE = /\bgenerator\s+(source|code|scripts?)\b|\bsource\s+code\b|^generator$/i;

/** Folder names that hold code only when they contain code files (a "Scripts" folder may hold documents). */
const MAYBE_CODE_RE = /^(src|scripts)$/i;
const CODE_FILE_RE = /\.(js|mjs|cjs|py)$/i;

/** Root-level files of a legacy vault that describe it rather than belong in it (folder mode). */
const ROOT_SPEC_RE = /^_.*\.csv$|HIERARCHY.*\.md$/i;

/**
 * A folder name that marks restricted content at any depth: after format characters (zero-width spaces…) and an
 * optional number prefix are removed, the normalised name starts with the word "restricted" not followed by a letter
 * ("Restricted", "10 Restricted", "Restricted-Security", "Restricted_Security", "Restricted (HR)", "Restricted Files").
 * "Unrestricted …" does not start with it, and "Restrictedness …" is a different word, so both import.
 */
export const isRestrictedName = (name) => {
  const k = key(stripNumber(String(name).replace(/\p{Cf}/gu, '')).replace(/\p{Cf}/gu, ''));
  return /^restricted(?!\p{L})/u.test(k);
};

/** Generic alternative names of the top-level slots, besides the configured and default folder names. */
const TOP_ALIASES = Object.freeze({
  company: ['company', 'corporate'],
  people: ['people', 'team', 'hr', 'human resources', 'employees', 'staff'],
  clients: ['clients', 'customers'],
  vendors: ['vendors', 'suppliers'],
  products: ['products'],
  finance: ['finance', 'accounts'],
  templates: ['templates'],
  references: ['references', 'reference'],
  group: ['group entities', 'group entity', 'group companies'],
  restricted: ['restricted', 'security'],
});

/** Entity kind of the party named by folders in each top-level slot (slots without one have no party). */
const PARTY_KIND = Object.freeze({ people: 'person', clients: 'client', vendors: 'vendor', products: 'product', group: 'group_entity' });

/** Index CSV columns (the format of the legacy `_index.csv`). */
export const INDEX_COLUMNS = Object.freeze(['original_path', 'vault_path', 'vault_folder', 'md5', 'size_bytes', 'note']);

const invalid = (message, details = {}) => new DossierError('INVALID_INPUT', message, details);
const toPosix = (p) => p.split(sep).join('/');
const stripNumber = (name) => String(name).replace(/^\d+\s*[-._)]?\s*/, '').trim();
const key = (s) => normaliseName(s);

/**
 * @typedef {{
 *   dryRun: boolean, folder: string, index: string|null, brandId: string,
 *   files: number, imported: number, existing: number, deduped: number, ignoredDsStore: number,
 *   newEntities: { kind: string, name: string }[],
 *   byType: Record<string, number>,
 *   numbers: { path: string, number: string, series: string, from: 'filename'|'text' }[],
 *   conflicts: { path: string, number: string, series: string, conflictsWith: string[] }[],
 *   duplicates: { path: string, of: string|null, reason: string }[],
 *   skipped: { path: string, reason: string }[],
 *   warnings: { path: string, message: string, code?: 'SOURCE_CHANGED' }[],
 *   documents: { path: string, id: string|null, type: string, typeFrom: TypeSource, party: string|null,
 *     partyKind: string|null, sensitivity: string, number: string|null, series: string|null,
 *     date: string|null, dateFrom: DateSource|null }[],
 *   dates: { text: number, filename: number, mtime: number, none: number },
 * }} ImportSummary
 *   `files` counts every file looked at (skipped folders count as one skipped entry, not their files);
 *   `imported` documents created (or, in a dry run, that would be); `existing` files whose bytes are already in the
 *   vault; `deduped` identical copies within the import (and index rows recorded as identical copies).
 * @typedef {'folder'|'name'|'keyword'|'text'|'series'|'leaf'|'none'} TypeSource how the type was found:
 *   `folder` the Templates/References folder, `name` a type name in the file name, `keyword` a type keyword in the file
 *   name, `text` a type phrase in the text, `series` the parsed number's series, `leaf` the leaf folder's only type,
 *   `none` nothing (type "Other")
 * @typedef {'text'|'filename'|'mtime'} DateSource where `doc_date` came from: the document's text, a date in its file
 *   name, or the source file's modification time
 */

/** Words recorded in the version note for each date source. */
export const DATE_SOURCE_NOTE = Object.freeze({ text: 'date from text', filename: 'date from file name', mtime: 'date from file time' });

/**
 * Import a folder of existing documents (or the files an index CSV lists) into the vault.
 *
 * - Folder mode walks `folder`, skipping dotfiles, `node_modules`, symbolic links, generator source folders (a name
 *   like "Generator Source" or a folder holding `package.json`) and the Restricted top-level folder.
 * - Index mode (`index`) reads a CSV with the columns {@link INDEX_COLUMNS}; `vault_path` is relative to the CSV's
 *   folder (the import root in this mode) unless absolute, rows with an empty `vault_path` (identical copies the index
 *   did not copy) are reported as duplicates, and the same skip rules apply to each path. Paths with `..`, absolute
 *   paths outside the root, symbolic links and files whose folder resolves outside the root are refused
 *   ("outside import root" / "symbolic link").
 * - A folder named "Restricted" (optionally numbered, or "Restricted - …") is skipped at any depth. Root-level
 *   `_*.csv` and `*HIERARCHY*.md` files are skipped as index/spec files; `.DS_Store` files are only counted.
 * - Each file is hashed: bytes already in the vault are left alone (re-running imports nothing new), a second copy
 *   within the run is a duplicate. Files the secret scanner flags are skipped. Every workspace series pattern is
 *   tried against the file name, then the extracted text; a hit sets the number and series and seeds the counter
 *   forward (`registerExisting`); a number already used in its series is filed with the conflict flag and reported.
 * - `only` (extensions such as `['pdf']`) imports only files with those extensions; the others are skipped with the
 *   reason "not in --only". Without it every file is considered.
 * - Type: see {@link chooseType}. Identity types (PAN, Aadhaar, Voter ID, Passport) are imported at the identity
 *   sensitivity at least, like files in an identity folder.
 * - Date: see {@link chooseDate}. Its source is kept in the version note and in `input_json.import.date_source`.
 * - `dryRun` reads and classifies everything but writes nothing (no entities, counters, blobs or documents).
 * @param {object} ctx
 * @param {{ folder: string, index?: string|null, dryRun?: boolean, brandId?: string, only?: string[]|null,
 *   sensitivity?: { default?: string, people?: string, identity?: string }, identityPattern?: RegExp, now?: Date }} opts
 *   `now` is the reference for the "at most a year ahead" date check (tests)
 * @returns {Promise<ImportSummary>}
 */
export async function importFolder(ctx, opts = {}) {
  if (opts === null || typeof opts !== 'object') throw invalid('importFolder needs options');
  if (typeof opts.folder !== 'string' || opts.folder.trim() === '') throw invalid('An import needs a folder');
  const folder = resolve(opts.folder);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw invalid(`Not a folder: ${folder}`, { folder });
  const index = opts.index ? resolve(opts.index) : null;
  if (index && (!existsSync(index) || !statSync(index).isFile())) throw invalid(`No index file at ${index}`, { index });
  const brandId = opts.brandId ?? ctx.ws.config.defaultBrand;
  if (!ctx.ws.brands.has(brandId)) throw new DossierError('BRAND_NOT_FOUND', `No brand "${brandId}" in the workspace`, { brandId });
  const sensitivity = { ...DEFAULT_IMPORT_SENSITIVITY, ...(opts.sensitivity ?? {}) };
  for (const [k, v] of Object.entries(sensitivity)) {
    if (!LEVELS.includes(v) || v === 'Restricted') throw invalid(`sensitivity.${k} must be Public, Internal or Confidential`, { [k]: v });
  }
  const identityRe = opts.identityPattern ?? IDENTITY_FOLDER_RE;
  if (!(identityRe instanceof RegExp)) throw invalid('identityPattern must be a RegExp');

  const only = onlyExtensions(opts.only);
  const now = opts.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw invalid('now must be a valid Date');

  const dryRun = opts.dryRun === true;
  const summary = {
    dryRun, folder, index, brandId, files: 0, imported: 0, existing: 0, deduped: 0, ignoredDsStore: 0, newEntities: [], byType: {},
    dates: { text: 0, filename: 0, mtime: 0, none: 0 },
    numbers: [], conflicts: [], duplicates: [], skipped: [], warnings: [], documents: [],
  };
  const keywords = typeKeywordTable(ctx.ws.config.import?.typeKeywords);
  const env = {
    ctx, folder, dryRun, brandId, sensitivity, identityRe, summary, only, now, keywords,
    cfg: routingConfig(ctx.ws.config.hierarchy),
    typeNames: typeNames(ctx, keywords),
    typesBySeries: typesBySeries(ctx, brandId),
    entityCache: new Map(),
    seen: new Map(), // sha256 -> path imported in this run
    numbersSeen: new Map(), // `${series}\u0000${number}` -> path (dry run conflict detection)
  };
  env.leafIndex = leafIndex(env);

  const entries = index ? readIndex(env, index) : walkFolder(env);
  for (const entry of entries) {
    summary.files++;
    try {
      await importOne(env, entry);
    } catch (e) {
      summary.skipped.push({ path: entry.rel, reason: `error: ${e.code ?? e.name}: ${e.message}` });
    }
  }
  summary.newEntities.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return summary;
}

/**
 * Normalise the `only` option: extensions without the dot, lower case, de-duplicated; null when not given.
 * @param {unknown} only
 * @returns {string[]|null}
 */
function onlyExtensions(only) {
  if (only === undefined || only === null) return null;
  if (!Array.isArray(only)) throw invalid('only must be a list of file extensions, e.g. ["pdf"]');
  const out = [];
  for (const raw of only) {
    const e = typeof raw === 'string' ? raw.trim().replace(/^\.+/, '').toLowerCase() : '';
    if (!/^[a-z0-9]+$/.test(e)) throw invalid(`only: "${raw}" is not a file extension`, { only });
    if (!out.includes(e)) out.push(e);
  }
  if (!out.length) throw invalid('only needs at least one file extension', { only });
  return out;
}

// ---------- file lists ----------

/** Why a directory is not imported (null when it is). `rel` is its path below the import root. */
function dirSkipReason(env, rel, abs) {
  const name = rel.split('/').pop();
  if (name.startsWith('.')) return 'hidden folder';
  if (name === 'node_modules') return 'node_modules';
  if (isRestrictedName(name)) return 'restricted folder (never imported)';
  if (!rel.includes('/') && matchTop(env, name)?.slot === 'restricted') return 'restricted folder (never imported)';
  const bare = stripNumber(name);
  if (GENERATOR_SOURCE_RE.test(bare)) return 'generator source code';
  if (abs && existsSync(`${abs}/package.json`)) return 'generator source code (package.json)';
  if (MAYBE_CODE_RE.test(bare) && abs && hasCodeFiles(abs)) return 'generator source code';
  return null;
}

function hasCodeFiles(abs) {
  try {
    return readdirSync(abs).some((f) => CODE_FILE_RE.test(f));
  } catch {
    return false;
  }
}

/** Skip reason of the first folder on `rel` (a file path below the root) that is skipped, or null. */
function pathSkipReason(env, rel, root) {
  const segs = rel.split('/');
  for (let i = 1; i < segs.length; i++) {
    const dirRel = segs.slice(0, i).join('/');
    const reason = dirSkipReason(env, dirRel, root ? `${root}/${dirRel}` : null);
    if (reason) return reason;
  }
  return segs.at(-1).startsWith('.') ? 'hidden file' : null;
}

function walkFolder(env) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const childAbs = `${abs}/${name}`;
      const childRel = rel ? `${rel}/${name}` : name;
      const st = lstatSync(childAbs);
      if (st.isSymbolicLink()) { env.summary.skipped.push({ path: childRel, reason: 'symbolic link' }); continue; }
      if (st.isDirectory()) {
        const reason = dirSkipReason(env, childRel, childAbs);
        if (reason) env.summary.skipped.push({ path: `${childRel}/`, reason });
        else walk(childAbs, childRel);
        continue;
      }
      if (!st.isFile()) continue;
      if (name === '.DS_Store') { env.summary.ignoredDsStore++; continue; }
      if (name.startsWith('.')) { env.summary.skipped.push({ path: childRel, reason: 'hidden file' }); continue; }
      if (!rel && ROOT_SPEC_RE.test(name)) { env.summary.skipped.push({ path: childRel, reason: 'index/spec file' }); continue; }
      out.push({ rel: childRel, abs: childAbs });
    }
  };
  walk(env.folder, '');
  return out;
}

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF, optional BOM) into rows of strings.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function readIndex(env, index) {
  const [header = [], ...rows] = parseCsv(readFileSync(index, 'utf8'));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  if (col.vault_path === undefined) {
    throw invalid(`${index}: the index needs a vault_path column (columns: ${INDEX_COLUMNS.join(', ')})`, { index });
  }
  const base = dirname(index);
  const realRoot = realpathSync(base);
  const out = [];
  for (const r of rows) {
    const get = (c) => (col[c] === undefined ? '' : (r[col[c]] ?? '').trim());
    const vaultPath = get('vault_path');
    const note = get('note');
    if (vaultPath === '') {
      env.summary.files++;
      env.summary.deduped++;
      env.summary.duplicates.push({ path: get('original_path') || '(no path)', of: null, reason: note || 'not copied by the index (no vault_path)' });
      continue;
    }
    const skip = (path, reason) => {
      env.summary.files++;
      env.summary.skipped.push({ path, reason });
    };
    // Every path must stay inside the import root (the CSV's folder): no `..`, no absolute path elsewhere, no
    // symbolic link, and no parent folder that resolves outside it.
    if (vaultPath.split(/[\\/]/).includes('..')) { skip(vaultPath, 'outside import root'); continue; }
    const abs = isAbsolute(vaultPath) ? resolve(vaultPath) : resolve(base, vaultPath);
    // Lexically inside the root as given or as it resolves (`/var/…` and `/private/var/…` are the same folder).
    const within = (root) => {
      const r = relative(root, abs);
      return r === '' || r.startsWith('..') || isAbsolute(r) ? null : r;
    };
    const lexical = within(base) ?? within(realRoot);
    if (lexical === null) { skip(vaultPath, 'outside import root'); continue; }
    const rel = toPosix(lexical);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      skip(rel, 'file not found');
      continue;
    }
    if (st.isSymbolicLink()) { skip(rel, 'symbolic link'); continue; }
    if (!st.isFile()) { skip(rel, 'not a file'); continue; }
    let realRel;
    try {
      realRel = relative(realRoot, realpathSync(dirname(abs)));
    } catch {
      skip(rel, 'file not found');
      continue;
    }
    if (realRel.startsWith('..') || isAbsolute(realRel)) { skip(rel, 'outside import root'); continue; }
    // The same skip rules as a folder walk, on the path as written and on the path as it resolves.
    const resolvedRel = [toPosix(realRel), rel.split('/').pop()].filter(Boolean).join('/');
    const reason = pathSkipReason(env, rel, base) ?? pathSkipReason(env, resolvedRel, realRoot);
    if (reason) { skip(rel, reason); continue; }
    out.push({ rel, abs, md5: get('md5').toLowerCase(), note });
  }
  return out;
}

// ---------- one file ----------

async function importOne(env, entry) {
  const { ctx, summary } = env;
  const { rel, abs } = entry;
  const st = existsSync(abs) ? lstatSync(abs) : null;
  if (!st) { summary.skipped.push({ path: rel, reason: 'file not found' }); return; }
  if (st.isSymbolicLink()) { summary.skipped.push({ path: rel, reason: 'symbolic link' }); return; }
  if (!st.isFile()) { summary.skipped.push({ path: rel, reason: 'not a file' }); return; }
  const filename = rel.split('/').pop();
  if (env.only && !env.only.includes(extname(filename).slice(1).toLowerCase())) {
    summary.skipped.push({ path: rel, reason: 'not in --only' });
    return;
  }
  const buffer = readFileSync(abs);
  if (entry.md5 && createHash('md5').update(buffer).digest('hex') !== entry.md5) {
    summary.warnings.push({ path: rel, message: 'md5 differs from the index (file changed since the index was written)' });
  }

  const early = secretReason({ filename, buffer });
  if (early) { summary.skipped.push({ path: rel, reason: `secret (${early})` }); return; }

  const sha = createHash('sha256').update(buffer).digest('hex');
  const inVault = ctx.db.prepare(
    'SELECT v.document_id AS id FROM renditions r JOIN versions v ON v.id = r.version_id WHERE r.blob_sha256 = ? ORDER BY v.document_id LIMIT 1',
  ).get(sha);
  // An identical copy of a file this run imported first (it is in the vault by now, unless this is a dry run).
  if (env.seen.has(sha)) {
    summary.deduped++;
    summary.duplicates.push({ path: rel, of: env.seen.get(sha), reason: 'identical copy' });
    return;
  }
  if (inVault) { summary.existing++; return; }
  // The same source path imported before with other bytes: the file changed since (it is filed as a new document).
  const earlier = ctx.db.prepare(
    "SELECT DISTINCT document_id AS id FROM versions WHERE json_extract(input_json, '$.import.source_path') = ? ORDER BY document_id",
  ).all(rel).map((r) => r.id);
  if (earlier.length) {
    summary.warnings.push({ path: rel, code: 'SOURCE_CHANGED', message: `SOURCE_CHANGED: imported before as ${earlier.join(', ')} with different bytes` });
  }

  const extracted = await extractText(buffer, { filename });
  const late = secretReason({ filename, buffer, text: extracted.text });
  if (late) { summary.skipped.push({ path: rel, reason: `secret (${late})` }); return; }

  const c = classify(env, rel);
  const found = parseDocNumber(env, filename, extracted.text);
  const { type, from: typeFrom } = chooseType(env, c, filename, found, extracted.text);
  const identityType = IDENTITY_TYPES.includes(type);
  const dated = chooseDate(extracted.text, filename, st.mtime, { now: env.now, identity: c.identity || identityType });
  const docDate = dated?.date ?? null;
  const level = identityType ? higher(c.sensitivity, env.sensitivity.identity) : c.sensitivity;
  if (!canAccess(ctx.user.clearance, level)) {
    summary.skipped.push({ path: rel, reason: `needs ${level} clearance (user "${ctx.user.id}" has ${ctx.user.clearance})` });
    return;
  }

  // Entities (created now, or only counted in a dry run).
  const party = c.party ? ensureEntity(env, c.party.kind, c.party.name) : null;
  const businessLine = c.businessLine ? ensureEntity(env, 'business_line', c.businessLine) : null;
  const engagement = c.engagement ? ensureEntity(env, 'engagement', c.engagement) : null;
  if (!env.dryRun) {
    if (party && businessLine && c.party.kind === 'client') relateOnce(ctx, party.id, businessLine.id, 'belongs_to_business_line');
    if (engagement && party && c.party.kind === 'client') relateOnce(ctx, engagement.id, party.id, 'engagement_of');
  }

  // Number conflicts: an existing document, or an earlier file of this run, with the same series and number.
  let conflictsWith = [];
  if (found) {
    summary.numbers.push({ path: rel, number: found.number, series: found.series, from: found.from });
    const numKey = `${found.series}\u0000${found.number}`;
    conflictsWith = ctx.db.prepare('SELECT id FROM documents WHERE number_series = ? AND doc_number = ? ORDER BY id')
      .all(found.series, found.number).map((r) => r.id);
    if (env.dryRun && env.numbersSeen.has(numKey)) conflictsWith.push(env.numbersSeen.get(numKey));
    env.numbersSeen.set(numKey, rel);
  }

  const title = filename.slice(0, filename.length - extname(filename).length).replace(/\s*\[from [^\]]*\]\s*$/i, '').trim() || filename;
  let id = null;
  if (!env.dryRun) {
    const meta = {
      type,
      title,
      sensitivity: level,
      ...(party ? { partyId: party.id } : {}),
      ...(businessLine ? { businessLineId: businessLine.id } : {}),
      ...(engagement ? { engagementId: engagement.id } : {}),
      ...(docDate ? { docDate } : {}),
      ...(found ? { numberSeries: found.series, docNumber: found.number, issuingBrandId: env.brandId } : {}),
      note: `Imported from ${rel}${dated ? ` (${DATE_SOURCE_NOTE[dated.from]})` : ''}`,
      inputJson: {
        import: {
          source_path: rel, source_folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
          ...(entry.note ? { index_note: entry.note } : {}), ...(dated ? { date_source: dated.from } : {}),
        },
      },
    };
    const res = await uploadFile(ctx, { buffer, filename, meta, extracted });
    id = res.document.id;
    if (found) {
      try {
        // A file-time date is a guess: it does not choose the counter's year.
        const seedDate = dated && dated.from !== 'mtime' ? { date: docDate } : {};
        registerExisting(ctx, found.series, found.number, { brandId: env.brandId, ...seedDate });
      } catch (e) {
        summary.warnings.push({ path: rel, message: `counter not seeded for ${found.number}: ${e.message}` });
      }
    }
  }
  if (found && conflictsWith.length) summary.conflicts.push({ path: rel, number: found.number, series: found.series, conflictsWith });

  env.seen.set(sha, rel);
  summary.imported++;
  summary.byType[type] = (summary.byType[type] ?? 0) + 1;
  summary.dates[dated?.from ?? 'none']++;
  summary.documents.push({
    path: rel, id, type, typeFrom, party: party?.name ?? null, partyKind: c.party?.kind ?? null, sensitivity: level,
    number: found?.number ?? null, series: found?.series ?? null, date: docDate, dateFrom: dated?.from ?? null,
  });
}

// ---------- classification ----------

/**
 * Which top-level slot a folder name stands for: configured or default names and generic aliases, compared on the
 * name after the number ("04 Products" -> products), a "<slot> - <leaf>" name ("06 Vendors - Invoices Received"), or
 * the name of a group entity already in the master list ("07 <group entity>").
 * @returns {{ slot: string, leaf?: string, entity?: { kind: string, name: string } } | null}
 */
function matchTop(env, name) {
  const part = stripNumber(name);
  const whole = key(part);
  const [head, ...rest] = part.split(/\s+-\s+/);
  const headKey = key(head);
  for (let i = 0; i < TOP_KEYS.length; i++) {
    const slot = TOP_KEYS[i];
    const names = new Set([key(stripNumber(env.cfg.topLevel[i])), key(stripNumber(TOP_LEVEL[i])), ...TOP_ALIASES[slot]]);
    if (names.has(whole)) return { slot };
    if (rest.length && names.has(headKey)) return { slot, leaf: rest.join(' - ').trim() };
  }
  if (findExisting(env.ctx, 'group_entity', part)) return { slot: 'group', entity: { kind: 'group_entity', name: part } };
  return null;
}

/**
 * Leaf name (lower-cased key) -> per slot, the types routed there, in routing-table order. `own` marks the types
 * routed to the leaf by name (not translated into it from another slot's leaf name), e.g. only "Vendor Invoice" is
 * routed to a vendor's "Invoices Received"; "Invoice" lands there through LEAF_MAP.
 * @returns {Map<string, string[]> & { own: Map<string, string[]> }}
 */
function leafIndex(env) {
  const { cfg } = env;
  const index = new Map(); // `${slot}\u0000${leafKey}` -> types
  const own = new Map();
  const add = (map, slot, leaf, type) => {
    if (!leaf) return;
    const k = `${slot}\u0000${key(leaf)}`;
    const list = map.get(k) ?? [];
    if (!list.includes(type)) list.push(type);
    map.set(k, list);
  };
  const types = [...cfg.routes.entries()];
  // Exact route leaves first, then the leaves they are translated to in each slot.
  for (const slot of TOP_KEYS) {
    for (const [t, r] of types) {
      const type = displayType(env, t);
      if (r.top === slot || (r.top === null && (r.override || !TOP_LEAVES[slot] || TOP_LEAVES[slot].includes(r.leaf)))) {
        add(index, slot, r.leaf, type);
        add(own, slot, r.leaf, type);
      }
    }
    for (const [t, r] of types) {
      if (r.top !== null || r.override) continue;
      const mapped = leafIn(slot, r.leaf);
      if (mapped && mapped !== DEFAULT_LEAF) add(index, slot, mapped, displayType(env, t));
    }
  }
  return Object.assign(index, { own });
}

/** Routing keys are lower case; give back the type as written in the default table or the workspace routing. */
const displayType = (env, typeKey) => env.typeNames.get(typeKey) ?? typeKey;

const routeKey = (t) => String(t).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Normalised type key -> the type's spelling, for every known type: the default routes, the keyword types and the
 * workspace routing (whose spelling wins).
 */
function typeNames(ctx, keywords) {
  const names = [...Object.keys(DEFAULT_ROUTES), ...[...keywords.values()].map((k) => k.type), ...Object.keys(ctx.ws.config.hierarchy?.routing ?? {})];
  return new Map(names.map((t) => [routeKey(t), t.trim().replace(/\s+/g, ' ')]));
}

/**
 * Types whose leaf in `slot` is the folder name `seg` (or whose name is the folder name, e.g. "MoU", "Invoices").
 * `own` are the types routed to that leaf by name (see {@link leafIndex}).
 * @returns {{ leaf: boolean, types: string[], own: string[] }}
 */
function leafTypes(env, slot, seg) {
  const k = key(seg);
  if (k === key(DEFAULT_LEAF)) return { leaf: true, types: [], own: [] };
  const byLeaf = slot ? env.leafIndex.get(`${slot}\u0000${k}`) : null;
  if (byLeaf?.length) return { leaf: true, types: byLeaf, own: env.leafIndex.own.get(`${slot}\u0000${k}`) ?? [] };
  const singular = k.endsWith('s') ? k.slice(0, -1) : k;
  const named = [...env.cfg.routes.keys()].filter((t) => key(t) === k || key(t) === singular).map((t) => displayType(env, t));
  if (named.length) return { leaf: true, types: named, own: named };
  if (slot && (TOP_LEAVES[slot]?.some((l) => key(l) === k) || Object.keys(LEAF_MAP[slot] ?? {}).some((l) => key(l) === k))) {
    return { leaf: true, types: [], own: [] };
  }
  return { leaf: false, types: [], own: [] };
}

/** Types whose route ends up in `slot` (used when a party folder has no leaf folder). */
function slotTypes(env, slot) {
  const out = [];
  for (const [k, list] of env.leafIndex) if (k.startsWith(`${slot}\u0000`)) for (const t of list) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * Split a file's folder path into slot, party, business line, engagement, leaf and sensitivity.
 * @returns {{ slot: string|null, party: { kind: string, name: string }|null, businessLine: string|null,
 *   engagement: string|null, leaf: string|null, leafTypes: string[], leafOwn: string[], sensitivity: string,
 *   identity: boolean }} `leafOwn`: the leaf's own types (routed to it by name), a subset of `leafTypes`
 */
function classify(env, rel) {
  const dirs = rel.split('/').slice(0, -1);
  const identity = dirs.some((d) => env.identityRe.test(d));
  const top = dirs.length ? matchTop(env, dirs[0]) : null;
  const slot = top?.slot ?? null;
  const out = { slot, party: null, businessLine: null, engagement: null, leaf: top?.leaf ?? null, leafTypes: [], leafOwn: [], identity };
  if (top?.leaf) ({ types: out.leafTypes, own: out.leafOwn } = leafTypes(env, slot, top.leaf));
  let level = slot === 'people' ? env.sensitivity.people : env.sensitivity.default;
  if (identity) level = higher(level, env.sensitivity.identity);
  out.sensitivity = level;
  if (!slot) return out;

  // Folders that are neither parties nor leaves: identity collections, financial-year folders.
  const segs = dirs.slice(1).filter((d) => !env.identityRe.test(d) && !/^FY\s?\d{4}/i.test(d));
  const leafAt = segs.findIndex((s) => leafTypes(env, slot, s).leaf);
  if (leafAt >= 0) {
    out.leaf = segs[leafAt];
    ({ types: out.leafTypes, own: out.leafOwn } = leafTypes(env, slot, segs[leafAt]));
  }
  const pre = leafAt >= 0 ? segs.slice(0, leafAt) : segs;
  const kind = PARTY_KIND[slot];
  if (!kind) return out;
  if (top.entity) {
    out.party = top.entity;
    return out;
  }
  if (slot === 'clients') {
    if (pre.length === 1) out.party = { kind, name: pre[0] };
    else if (pre.length >= 2) {
      const firstIsClient = findExisting(env.ctx, 'client', pre[0]) && !findExisting(env.ctx, 'business_line', pre[0]);
      if (firstIsClient) {
        out.party = { kind, name: pre[0] };
        out.engagement = pre[1];
      } else {
        out.businessLine = pre[0];
        out.party = { kind, name: pre[1] };
        out.engagement = pre[2] ?? null;
      }
    }
    return out;
  }
  if (pre.length) out.party = { kind, name: pre[0] };
  return out;
}

const higher = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);

/**
 * Document type of a classified file, and how it was found. In order:
 * 1. the Templates or References folder (the folder is the type, whatever the file is a template of);
 * 2. a type name written in the file name ("…_Debit Note_…", "MoU");
 * 3. a type keyword or alias in the file name ("pancard", "moa"; built-ins plus `import.typeKeywords`);
 * 4. a type phrase in the first part of the extracted text ("Permanent Account Number");
 * 5. the series of the parsed document number;
 * 6. the leaf folder's type, when the leaf maps to exactly one;
 * 7. otherwise "Other", never the first of several leaf types.
 * Keywords match whole words only ("pan" is not in "company"). When a step finds several types, one that fits the
 * folder (the leaf's types, else the top-level folder's) wins, then the longest name.
 * @returns {{ type: string, from: TypeSource }}
 */
function chooseType(env, c, filename, found, text) {
  if (c.slot === 'templates') return { type: 'Template', from: 'folder' };
  if (c.slot === 'references') return { type: 'Reference', from: 'folder' };
  // Folder fit, most specific first: the leaf's own types, all its types, else the top-level folder's types.
  const scopes = c.leafTypes.length ? [c.leafOwn, c.leafTypes] : [c.slot ? slotTypes(env, c.slot) : []];
  // The name as written, without an index's "[from …]" note.
  const words = wordsOf(filename.replace(/\.[^.]+$/, '').replace(/\s*\[from [^\]]*\]\s*$/i, ''));

  const named = pickType([...env.typeNames.values()].filter((t) => hasKeyword(words, t)), scopes);
  if (named) return { type: named, from: 'name' };

  const keyed = [...env.keywords.values()].filter((k) => k.names.some((n) => hasKeyword(words, n)));
  const byKeyword = pickType(keyed.map((k) => displayType(env, routeKey(k.type))), scopes);
  if (byKeyword) return { type: byKeyword, from: 'keyword' };

  const phrase = textType(text, env.keywords);
  if (phrase) return { type: displayType(env, routeKey(phrase.type)), from: 'text' };

  const seriesTypes = found ? env.typesBySeries.get(found.series) ?? [] : [];
  const bySeries = scopes.flat().find((t) => seriesTypes.includes(t)) ?? (seriesTypes.length === 1 ? seriesTypes[0] : null);
  if (bySeries) return { type: bySeries, from: 'series' };

  const single = [c.leafOwn, c.leafTypes].find((list) => list.length === 1);
  if (single) return { type: single[0], from: 'leaf' };
  return { type: DEFAULT_LEAF, from: 'none' };
}

/**
 * The best of several candidate types. For each folder scope in turn (most specific first): a candidate in the
 * scope, else a scope type whose name contains a candidate's ("Invoice" in a vendor's "Invoices Received" folder is
 * a "Vendor Invoice"). Without a fit, the longest candidate. Ties go to the longer name. Null without candidates.
 * @param {string[]} candidates
 * @param {string[][]} scopes
 * @returns {string|null}
 */
function pickType(candidates, scopes) {
  if (!candidates.length) return null;
  const longest = (list) => [...list].sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
  for (const scope of scopes) {
    const fit = candidates.filter((t) => scope.includes(t));
    if (fit.length) return longest(fit);
    const wider = scope.filter((s) => candidates.some((t) => hasKeyword(wordsOf(s), t)));
    if (wider.length) return longest(wider);
  }
  return longest(candidates);
}

/**
 * Document date and where it came from, in order: a labelled date in the text ("Date:", "Dated", "Date of Issue",
 * "Issued on", "Invoice Date", "Date of Incorporation", "w.e.f."); the first plausible date in the text (not for
 * identity documents, whose other dates are birth or expiry dates); an ISO date in the file name; the source file's
 * modification time. Dates before 1990 or more than a year after `now` are ignored.
 * @param {string} text extracted text (the first 3000 characters are read)
 * @param {string} filename
 * @param {Date|null} mtime
 * @param {{ now?: Date, identity?: boolean }} [opts]
 * @returns {{ date: string, from: DateSource } | null}
 */
export function chooseDate(text, filename, mtime, { now = new Date(), identity = false } = {}) {
  const inText = findTextDate(text, { now, labelledOnly: identity });
  if (inText) return { date: inText.date, from: 'text' };
  const inName = dateIn(filename);
  if (inName) return { date: inName, from: 'filename' };
  if (mtime instanceof Date && !Number.isNaN(mtime.getTime())) {
    // The local calendar day, as the file's details show it.
    const iso = plausibleDate(mtime.getDate(), mtime.getMonth() + 1, mtime.getFullYear(), now);
    if (iso) return { date: iso, from: 'mtime' };
  }
  return null;
}

/** First valid ISO date (YYYY-MM-DD) in a file name, or null. */
function dateIn(filename) {
  for (const m of filename.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso)) return iso;
  }
  return null;
}

// ---------- numbers ----------

/** Series id -> document types of the templates numbered in it (for this brand). Read-only. */
function typesBySeries(ctx, brandId) {
  const map = new Map();
  const brand = ctx.ws.brands.get(brandId);
  for (const t of peekTemplates(ctx)) {
    const n = t.meta.numbering;
    if (!n || !t.meta.type) continue;
    const sid = n.series === 'brand' ? brand.series?.[t.id] : n.series;
    if (!sid) continue;
    const list = map.get(sid) ?? [];
    if (!list.includes(t.meta.type)) list.push(t.meta.type);
    map.set(sid, list);
  }
  return map;
}

/**
 * The document number in a file: every workspace series is tried against the file name (with `/` matching `-` or `_`)
 * and then the extracted text. In the name the longest hit wins; in the text the first one (a document's own number
 * comes before the numbers it refers to), ties going to the longer match, then to series order.
 * @returns {{ series: string, number: string, from: 'filename'|'text' } | null}
 */
function parseDocNumber(env, filename, text) {
  const series = [...env.ctx.ws.series.values()];
  const best = (source, loose, better) => {
    let pick = null;
    for (const s of series) {
      for (const hit of findNumbers(s.pattern, source, { looseSeparators: loose })) {
        if (!pick || better(hit, pick)) pick = { ...hit, series: s.id };
      }
    }
    return pick;
  };
  const name = best(filename, true, (a, b) => a.length > b.length);
  if (name) return { series: name.series, number: name.number, from: 'filename' };
  const inText = best(text ?? '', false, (a, b) => a.index < b.index || (a.index === b.index && a.length > b.length));
  return inText ? { series: inText.series, number: inText.number, from: 'text' } : null;
}

// ---------- entities ----------

/** Folder name -> canonical name and aliases: "Example Institute (EI)" -> name "Example Institute", alias "EI". */
export function folderEntityName(raw) {
  const s = String(raw).trim().replace(/\s+/g, ' ');
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(s);
  if (m && /[\p{L}\p{N}]/u.test(m[1])) return { name: m[1].trim(), aliases: [m[2].trim()] };
  return { name: s, aliases: [] };
}

/** Id of the entity of `kind` whose name or an alias equals `name` (after normalisation), or null. */
function findExisting(ctx, kind, name) {
  const k = key(name);
  if (!k) return null;
  const hit = findEntities(ctx, { q: name, kind, limit: 500 })
    .find((e) => key(e.name) === k || e.aliases.some((a) => key(a) === k));
  return hit?.id ?? null;
}

/**
 * The entity a folder names: found by name or alias, else created (canonical name plus the alias in brackets). An
 * alias match adds the folder's name as an alias. In a dry run nothing is written and new entities are only counted.
 * @returns {{ id: number|null, name: string }}
 */
function ensureEntity(env, kind, raw) {
  const cacheKey = `${kind}\u0000${key(raw)}`;
  if (env.entityCache.has(cacheKey)) return env.entityCache.get(cacheKey);
  const { ctx } = env;
  const { name, aliases } = folderEntityName(raw);
  const free = (n) => findExisting(ctx, kind, n) === null;
  let result;
  const byName = findExisting(ctx, kind, name);
  const aliasHit = aliases.find((a) => !free(a));
  if (byName !== null) {
    if (!env.dryRun) {
      for (const a of aliases.filter(free)) upsertEntity(ctx, { kind, name: a, aliasOf: byName });
    }
    result = { id: byName, name: getEntity(ctx, byName).name };
  } else if (aliasHit) {
    const id = findExisting(ctx, kind, aliasHit);
    // aliasOf by name: resolved within this kind (the alias may also name an entity of another kind).
    if (!env.dryRun) upsertEntity(ctx, { kind, name, aliasOf: aliasHit });
    result = { id, name: getEntity(ctx, id).name };
  } else {
    env.summary.newEntities.push({ kind, name });
    result = env.dryRun
      ? { id: null, name }
      : { id: upsertEntity(ctx, { kind, name, aliases: aliases.filter(free) }).id, name };
  }
  env.entityCache.set(cacheKey, result);
  return result;
}

/** Relate two entities unless `from` already has a relation with that role (a client keeps its business line). */
function relateOnce(ctx, from, to, role) {
  const has = ctx.db.prepare('SELECT 1 FROM entity_relations WHERE from_id = ? AND role = ?').get(from, role);
  if (!has) relateEntities(ctx, from, to, role);
}
