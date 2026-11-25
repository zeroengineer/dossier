// Hand-mirrored shapes of the Dossier JSON API (src/web/routes/*.js). Keep nullables explicit.

/** Every API error body: `{ code, message, details }` (src/web/http.js errorReply). */
export interface ApiErrorBody {
  code: string
  message: string
  details: Record<string, unknown>
}

export type Status = "Draft" | "Sent" | "Signed" | "Paid" | "Superseded"
export type SensitivityLevel = "Public" | "Internal" | "Confidential" | "Restricted"

export interface Locale {
  currencySymbol: string
  currencyCode: string
  numberLocale: string
  dateFormats: { short: string; long: string; us: string }
  currencyWords?: { major: string; minor: string; suffix: string }
}

export interface BrandSummary {
  id: string
  legalName: string
  shortName: string
}

/** `GET /api/me`. */
export interface Me {
  user: { id: string; clearance: SensitivityLevel }
  workspace: {
    name: string
    defaultBrand: string
    locale: Locale
    home: string
    dataDir: string
  }
  brands: BrandSummary[]
  version: string
}

/** `GET /api/meta`. */
export interface Meta {
  statuses: Status[]
  transitions: Record<Status, Status[]>
  sensitivityLevels: SensitivityLevel[]
  clearances: SensitivityLevel[]
  relationTypes: string[]
  entityRoles: string[]
  partyTypes: string[]
  entityKinds: string[]
  entityRelationRoles: string[]
  seriesScopes: string[]
  fontWeights: string[]
  builtinFonts: string[]
  documentTypes: string[]
  hierarchy: {
    topLevel: string[]
    topKeys: string[]
    leaves: Record<string, string[]>
    defaultLeaf: string
  }
  templateCategories: string[]
  fieldTypes: string[]
  limits: { assetMaxBytes: number; uploadMaxBytes: number }
}

// documents (shared shapes)

/** Party / entity reference inside a document summary (src/services/documentQueries.js entityRef + party type). */
export interface DocumentPartyRef {
  id: number
  kind: string
  name: string
  type: string
}

/** `DocumentSummary` (src/services/documentQueries.js summaryOf): one row of lists, dashboards and search hits. */
export interface DocumentSummary {
  id: string
  type: string
  title: string
  status: Status
  sensitivity: SensitivityLevel
  party: DocumentPartyRef | null
  docNumber: string | null
  numberSeries: string | null
  numberConflict: boolean
  docDate: string | null
  dueDate: string | null
  /** Integer minor units (paise, cents); `currency` is set whenever this is. */
  amountMinor: number | null
  currency: string | null
  currentVersion: number | null
  updatedAt: string
}

// dashboard

/** Range lengths `GET /api/dashboard?days=` accepts (src/services/dashboard.js DASHBOARD_DAYS). */
export const DASHBOARD_DAYS = [7, 30, 90] as const
export type DashboardDays = (typeof DASHBOARD_DAYS)[number]

/** Per-currency sum of Invoice amounts (not Superseded) in a range. Sorted by currency. */
export interface DashboardInvoiced {
  currency: string
  amountMinor: number
}

/** A numbering counter (src/services/numbering.js listCounters). `value` is the next number it hands out. */
export interface SeriesCounter {
  seriesId: string
  /** Every series drawing from this counter; empty when the owner was removed from series.json. */
  seriesIds: string[]
  key: string
  value: number
}

export interface DashboardWarning {
  /** e.g. TEMPLATE_INVALID (or another template load error code), NUMBER_CONFLICT, BRAND_ASSET_MISSING. */
  code: string
  message: string
  /** SPA path to fix it: `/templates`, `/documents/:id`, `/settings/brands/:id`. */
  href: string
}

/** `GET /api/dashboard?days=7|30|90` (src/services/dashboard.js dashboardSummary). Dates are local YYYY-MM-DD. */
export interface DashboardSummary {
  /** The last `days` local calendar days including today, inclusive. */
  range: { days: DashboardDays; from: string; to: string }
  kpis: {
    /** Documents falling in the range (docDate, else local creation date). */
    documents: number
    /** Documents in status Draft, all time. */
    drafts: number
    invoiced: DashboardInvoiced[]
    /** Documents flagged with a number conflict, all time. */
    numberConflicts: number
  }
  /** `documents` and `invoiced` over the `days` days just before the range. */
  previous: { from: string; to: string; documents: number; invoiced: DashboardInvoiced[] }
  /** One entry per day of the range, oldest first, zero-filled; sums to `kpis.documents`. */
  timeline: Array<{ date: string; count: number }>
  /** The 10 documents updated last. */
  recent: DocumentSummary[]
  counters: SeriesCounter[]
  warnings: DashboardWarning[]
}

// document

/** Rendition kinds (src/domain/enums.js RENDITION_KINDS). `original` is an uploaded file as it came in. */
export type RenditionKind = "pdf" | "html" | "md" | "original"

/** One stored file of a version (src/services/documentQueries.js renditionsOf). */
export interface DocumentRendition {
  id: number
  kind: RenditionKind
  sha256: string
  bytes: number
  mime: string
  filename: string
  /** Human file name (date, party, type, number, version). */
  displayName: string
  pageCount: number | null
  createdAt: string
}

/** One version of a document with its renditions (src/services/documentQueries.js versionView). */
export interface DocumentVersion {
  id: number
  versionNo: number
  isCurrent: boolean
  note: string | null
  /** The generator input of a generated version; null for uploads. */
  input: unknown
  createdBy: string | null
  createdAt: string
  renditions: DocumentRendition[]
}

/** An entity a document field points at (business line, engagement, issuing entity). */
export interface DocumentEntityRef {
  id: number
  kind: string
  name: string
}

/** A document–entity link with its role (src/services/documentQueries.js documentEntities). */
export interface DocumentEntityLink extends DocumentEntityRef {
  role: string
}

/** A relation in either direction (src/services/documentQueries.js relationsOf). `out`: this document → the other end. */
export interface DocumentRelation {
  id: number
  type: string
  direction: "out" | "in"
  /** The other document, or null when the other end is a template (`template:<id>@<version>`). */
  document: { id: string; type: string; title: string; docNumber: string | null; status: Status } | null
  template: { id: string; version: number } | null
  attrs: Record<string, unknown>
}

/** `GET /api/documents/:id` (src/services/documentQueries.js getDocument). */
export interface DocumentDetail extends DocumentSummary {
  businessLine: DocumentEntityRef | null
  engagement: DocumentEntityRef | null
  issuingEntity: DocumentEntityRef | null
  issuingBrandId: string | null
  template: { id: string; version: number | null } | null
  /** Renditions of the current version (empty when there is none). */
  renditions: DocumentRendition[]
  /** Every version, oldest first. */
  versions: DocumentVersion[]
  entities: DocumentEntityLink[]
  relations: DocumentRelation[]
  createdBy: string | null
  createdAt: string
}

// templates

/** Where a template comes from (src/services/templates.js): shipped with Dossier, or the workspace's `templates/`. */
export type TemplateSource = "builtin" | "workspace"

/** `numbering` of a template.json: `series` is a series id, or `"brand"` for the brand's own series for the template. */
export interface TemplateNumbering {
  series: string
  required?: boolean
}

/** One row of `GET /api/templates` (src/web/routes/templates.js entrySummary). */
export interface TemplateSummary {
  id: string
  version: number
  type: string
  title: string
  category: string
  source: TemplateSource
  description: string | null
  sensitivity: SensitivityLevel
  renditions: string[]
  numbering: TemplateNumbering | null
  /** Present (true) on a workspace override that reuses a built-in template's module. */
  inherits?: true
}

/** A template folder that does not load (src/services/templates.js errorEntry). */
export interface TemplateLoadError {
  id: string
  source: TemplateSource
  /** Server path of the template folder. */
  path: string
  code: string
  message: string
  details: Record<string, unknown>
}

/** `GET /api/templates`. Templates sorted by id; folders that fail to load are listed in `errors` instead. */
export interface TemplateList {
  templates: TemplateSummary[]
  errors: TemplateLoadError[]
}

// vault

/** One document listed in a tree folder (src/services/hierarchy.js TreeDocument). */
export interface TreeDocument {
  id: string
  /** Display file name: `<date>_<party>_<type>_<number>_v<version>.<ext>`. */
  displayName: string
  type: string
  status: Status
  sensitivity: SensitivityLevel
  docDate: string | null
}

/**
 * `GET /api/tree?node=<id>` (src/services/hierarchy.js getNode): one folder with its whole subtree. The root has id
 * `''` and name `''`; its children are the top-level folders. Ids are stable slugs (`03/events/acme/invoices`).
 */
export interface TreeNode {
  id: string
  name: string
  /** Folder names joined by `/` (`03 Clients/Events/Acme Events`). */
  path: string
  children: TreeNode[]
  documents: TreeDocument[]
}

// documents (list)

/** `GET /api/documents` query (src/services/documentQueries.js listDocuments FILTERS). Dates are YYYY-MM-DD, inclusive. */
export interface DocumentListParams {
  type?: string
  status?: Status
  partyId?: number
  from?: string
  to?: string
  /** 1..500, default 50. */
  limit?: number
  offset?: number
}

/** `GET /api/documents`: one page of documents, newest document date first, and the count of every match. */
export interface DocumentList {
  documents: DocumentSummary[]
  /** Every document matching the filters that the user may see, ignoring limit/offset. */
  total: number
}

/** An entity offered as a party in the documents filter (`GET /api/entities` hit / `GET /api/entities/:id` subset). */
export interface DocumentPartyOption {
  id: number
  kind: string
  name: string
}

// document actions

/**
 * Body of `POST /api/documents/:id/metadata` (src/services/documents.js updateMetadata): the fields the document page
 * edits. Omitted fields stay as they are; null clears a date or the number. Status changes go through `/status`.
 */
export interface DocumentMetadataPatch {
  title?: string
  docNumber?: string | null
  docDate?: string | null
  dueDate?: string | null
  sensitivity?: SensitivityLevel
}

/** Answer of `POST /api/documents/:id/metadata`: the document plus warnings (`NUMBER_CONFLICT`). */
export interface DocumentMetadataResult extends DocumentDetail {
  warnings: string[]
}

/** Body of `POST /api/documents/:id/links`: relate this document `--type-->` `toId`. */
export interface DocumentLinkInput {
  toId: string
  type: string
  attrs?: Record<string, unknown>
}

/** `201` answer of `POST /api/documents/:id/links` (src/services/documents.js relationView). */
export interface DocumentLink {
  id: number
  from: string
  /** A document id, or `template:<id>@<version>` for `generated_from`. */
  to: string
  type: string
  attrs: Record<string, unknown>
}

/** Answer of `DELETE /api/documents/:id/links?toId&type`: false when the link did not exist. */
export interface DocumentUnlinkResult {
  removed: boolean
}

/** The part of `GET /api/search` the link picker reads (src/services/search.js SearchHit). */
export interface DocumentLinkSearch {
  hits: Array<{ document: DocumentSummary; score: number; match: "number" | "metadata" | "text"; snippet: string | null }>
}

// search

/** How a search hit matched (src/services/search.js): document number or id, metadata (title, number, parties), or text. */
export type SearchMatch = "number" | "metadata" | "text"

/** One ranked hit of `GET /api/search`. */
export interface SearchHit {
  document: DocumentSummary
  /** Relevance, higher is better (negated bm25; 0 for a number match without a text match). */
  score: number
  match: SearchMatch
  /** For text matches: an extract of the document text with matched terms between `[` and `]`; null otherwise. */
  snippet: string | null
}

/** A document one hop from a hit (a document relation) or from a matched entity (party, signatory, named). */
export interface SearchRelated {
  document: DocumentSummary
  /** `from` is the hit's document id (kind `document`) or the entity id (kind `entity`); `relation` the type or role. */
  via: { kind: "entity" | "document"; relation: string; from: string | number }
}

/** An entity whose name or an alias contains the query (src/services/entities.js findEntities). */
export interface SearchEntity {
  id: number
  kind: string
  name: string
  brand: string | null
  aliases: string[]
  /** The alias that matched, when the match was on an alias rather than the name. */
  matched: string | null
}

/** `GET /api/search?q=&limit=` (src/services/search.js search). */
export interface SearchResult {
  hits: SearchHit[]
  related: SearchRelated[]
  entities: SearchEntity[]
}

// upload

/** One numbering series of `GET /api/series` (the workspace's series.json as stored). */
export interface UploadSeries {
  id: string
  pattern: string
  scope: string
  start?: number
  /** Another series whose counter this one shares. */
  counter?: string
}

/** `POST /api/upload` → 201 (src/services/upload.js uploadFile). */
export interface UploadResult {
  /** The created document, or the document that got the new version. */
  document: DocumentDetail
  version: DocumentVersion
  /** True when a file with the same bytes (sha256) was already stored; the stored copy is reused. */
  deduped: boolean
  /** Warning codes, e.g. NUMBER_CONFLICT when the number is already used in its series. */
  warnings: string[]
}

// generate

/** A field's input type in template.json (`meta.fieldTypes`); `null` when the template leaves it untyped. */
export type TemplateFieldType =
  | "string"
  | "text"
  | "date"
  | "money"
  | "number"
  | "enum"
  | "entity"
  | "array"
  | "object"
  | "boolean"

/** One field of a template.json `fields` list, as stored (only what the form reads is typed). */
export interface TemplateMetaField {
  name: string
  label?: string
  type?: TemplateFieldType
  source?: string
  required?: boolean
  default?: unknown
  help?: string
  enum?: unknown
  item?: Record<string, string>
}

/** A template.json body (`GET /api/templates/:id` `meta`); keys the UI does not read are left untyped. */
export interface TemplateMeta {
  id: string
  version: number
  type: string
  title: string
  description?: string
  category: string
  sensitivity: SensitivityLevel
  renditions: string[]
  numbering?: TemplateNumbering
  fields: TemplateMetaField[]
  [key: string]: unknown
}

/** One input field of the generate form (src/services/fields.js formFields): the labelled fields of the template. */
export interface TemplateField {
  /** Dotted input path (`billTo.name`). */
  name: string
  label: string
  type: TemplateFieldType | null
  required: boolean
  help: string | null
  /** Where the value comes from when not given: `ask`, `today`, `entity:client`, `client.name`, `signatory`, … */
  source?: string
  /** Entity kind of an `entity:<kind>` source. */
  entityKind: string | null
  /** Allowed values (enum fields; brand lists resolved for the brand asked for). */
  choices: string[] | null
  /** Row columns of a list field: column name -> item type (`text`, `string`, `money`, `number`, `date`, `boolean`). */
  item: Record<string, string> | null
}

/** `GET /api/templates/:id?brandId=`. */
export interface TemplateDetail {
  id: string
  version: number
  source: TemplateSource
  hash: string
  meta: TemplateMeta
  fields: TemplateField[]
}

/** One row of `GET /api/entities` (src/services/entities.js findEntities), as the generate form lists it. */
export interface EntityMatch {
  id: number
  kind: string
  name: string
  brand: string | null
  aliases: string[]
  /** The alias the query matched, when it was not the name. */
  matched: string | null
}

/** `GET /api/entities?kind=&q=&limit=`. */
export interface EntityMatchList {
  entities: EntityMatch[]
}

// entities

/** One row of `GET /api/entities` (src/services/entities.js findEntities + the route's `documentCount`). */
export interface EntitySummary {
  id: number
  kind: string
  name: string
  /** Brand id the entity is linked to, or null. */
  brand: string | null
  aliases: string[]
  /** With `q`: the alias that matched when the name itself did not match exactly. */
  matched: string | null
  /** Documents within the caller's clearance referencing the entity in any role. */
  documentCount: number
}

/** `GET /api/entities?q=&kind=&limit=` (limit 1..500, default 50). */
export interface EntityList {
  entities: EntitySummary[]
}

/** A relation in either direction (src/services/entities.js relationsOf). `out`: this entity --role--> `entity`. */
export interface EntityRelationView {
  id: number
  role: string
  direction: "out" | "in"
  entity: { id: number; kind: string; name: string }
  attrs: Record<string, unknown>
}

/** `GET /api/entities/:id` and the body `POST /api/entities` answers with (src/services/entities.js fullEntity). */
export interface EntityDetail {
  id: number
  kind: string
  name: string
  /** Normalised canonical key. */
  key: string
  brand: string | null
  attrs: Record<string, unknown>
  aliases: string[]
  relations: EntityRelationView[]
  /** Documents within the caller's clearance referencing the entity in any role. */
  documentCount: number
  createdAt: string
  updatedAt: string
}

/**
 * `POST /api/entities` body (src/services/entities.js upsertEntity). With `id` it updates that entity: aliases are
 * added (never removed), attrs shallow-merged (a null value deletes the key), `brand: null` clears the link.
 */
export interface EntityInput {
  id?: number
  kind?: string
  name: string
  aliases?: string[]
  attrs?: Record<string, unknown>
  brand?: string | null
}

/** `POST /api/entities/:id/relations` answer (src/services/entities.js relationView). */
export interface EntityRelation {
  id: number
  from: number
  to: number
  role: string
  attrs: Record<string, unknown>
}

// settings

/** A row of `GET /api/brands` (src/web/routes/settings.js brandList). `inheritsFrom` is absent for a root brand. */
export interface BrandListItem {
  id: string
  legalName: string
  inheritsFrom?: string
}

/** `GET /api/brands`. */
export interface BrandList {
  brands: BrandListItem[]
}

export interface BrandContact {
  email?: string
  phone?: string
  website?: string
}

export interface BrandBankAccount {
  accountName: string
  bankName: string
  accountNumber: string
  ifsc?: string
  swift?: string
  branch?: string
}

export interface BrandSignatory {
  id: string
  name: string
  title: string
  titleLong?: string
  signature?: string
  signatureLarge?: string
  email?: string
  phone?: string
}

export interface BrandTaxMode {
  id: string
  label: string
  /** `rate` is a fraction (0.09 = 9%). */
  rates: Array<{ label: string; rate: number }>
}

/** A brand as validated by the workspace (src/workspace/schemas.js BrandSchema): inheritance and defaults applied. */
export interface ResolvedBrand {
  id: string
  inheritsFrom?: string
  legalName: string
  shortName: string
  registrations: Array<{ label: string; value: string }>
  addresses: { business: string[]; registered?: string[] }
  contacts: Record<string, BrandContact>
  bankAccounts: BrandBankAccount[]
  letterhead: { lines: string[] }
  footer: { left: string; center: string; right: string }
  palette: Record<string, string>
  fonts: Record<string, string>
  assets: { logo: string; seal?: string; watermark?: string }
  signatories: BrandSignatory[]
  defaultSignatory: Record<string, string>
  projectContact?: string
  strings: Record<string, string>
  tax: { modes: BrandTaxMode[]; defaultMode: string; defaultHsn?: string }
  series: Record<string, string>
  layoutProfiles?: Record<string, Record<string, unknown>>
  templateParams: Record<string, Record<string, unknown>>
}

/**
 * A brand's own `brand.json` as stored: hand-editable, so any key may be missing or of an unexpected shape (a brand
 * with `inheritsFrom` stores only its overrides) and unknown keys are kept.
 */
export interface BrandFile {
  id: string
  inheritsFrom?: string
  [key: string]: unknown
}

/** `GET /api/brands/:id` and `PUT /api/brands/:id` (src/web/routes/settings.js brandJson). */
export interface BrandDetail {
  id: string
  file: BrandFile
  resolved: ResolvedBrand
  /** Hash of the resolved brand; changes whenever the brand (or a brand it inherits from) changes. */
  configHash: string
  /** sha256 (hex) of the stored brand.json bytes: sent back as `If-Match` so a save never overwrites a change made elsewhere. */
  fileHash: string
}

/** Where an asset slot's file comes from (`null`: nothing is drawn, e.g. an unset watermark). */
export type BrandAssetSource = "configured" | "default" | "fallback" | "placeholder" | null

/** One asset slot of `GET /api/brands/:id/assets` (src/web/routes/settings.js brandAssetList). */
export interface BrandAsset {
  /** `assets.logo`, `assets.seal`, `assets.watermark`, `signature:<id>`, `signature-large:<id>`, `font:<weight>`. */
  key: string
  path: string | null
  source: BrandAssetSource
  /** True when the brand provides the file itself (`source` configured or default). */
  present: boolean
  version: string | null
  /** Served URL, already pinned with `?v=` when there is a version. */
  url: string
}

/** `GET /api/brands/:id/assets`. */
export interface BrandAssets {
  assets: BrandAsset[]
}

/** `POST /api/brands/:id/assets/:key`: the stored file and the brand after the write. */
export interface BrandAssetUpload {
  key: string
  path: string
  sha256: string
  bytes: number
  /** brand.json's new file hash (the upload rewrote it); the same as `brand.fileHash`. */
  fileHash: string
  brand: BrandDetail
}

// generate preview

/** `POST /api/templates/:id/generate` body (src/web/routes/templates.js; src/services/generator.js generateDocument). */
export interface GenerateRequest {
  input: Record<string, unknown>
  /** New documents only: the issuing brand (absent: the workspace default). A regenerate keeps the document's brand. */
  brandId?: string
  /** Regenerate: the document to add a version to (same template and brand; it keeps its number). */
  documentId?: string
  /** Regenerate a Sent/Signed/Paid document anyway (it goes back to Draft); without it the server answers STATUS_LOCKED. */
  force?: boolean
  /** The new version's note. */
  note?: string
}

/** One stored file of a generated version. */
export interface GeneratedRendition {
  kind: string
  sha256: string
  filename: string
  bytes: number
}

/** 201 from `POST /api/templates/:id/generate`. */
export interface GenerateResult {
  documentId: string
  /** The document number; null for templates without numbering. */
  number: string | null
  versionNo: number
  renditions: GeneratedRendition[]
  /** Placeholders that printed empty (`PLACEHOLDER_EMPTY` …). */
  warnings: { code?: string; name: string; message: string }[]
}

// settings: numbering and workspace

/**
 * One series of series.json as stored (`GET`/`PUT /api/series`). `scope` absent means the default (brand+year),
 * `counter` absent means the series owns its counter. Keys the settings form does not edit are kept on save.
 */
export interface SeriesEntry {
  id: string
  pattern: string
  scope?: string
  start?: number
  /** Another series whose counter this one shares. */
  counter?: string
  [key: string]: unknown
}

/** `GET /api/series` and the `PUT /api/series` answer (the stored list). */
export interface SeriesList {
  series: SeriesEntry[]
  /** sha256 (hex) of series.json's bytes (null when the file does not exist); sent back as `If-Match` on save. */
  fileHash: string | null
}

/** `GET /api/series/usage`: series id -> uses (`<brandId>: <documentType>`, `template <id>`), in workspace order. */
export interface SeriesUsage {
  usage: Record<string, string[]>
}

/** workspace.json as stored (`GET`/`PUT /api/workspace`). Blank locale keys are absent (the server's defaults apply). */
export interface WorkspaceFile {
  name: string
  defaultBrand: string
  locale?: {
    currencySymbol?: string
    currencyCode?: string
    numberLocale?: string
    dateFormats?: { short?: string; long?: string; us?: string }
    currencyWords?: { major?: string; minor?: string; suffix?: string }
  }
  /** User id -> clearance; an unlisted user or a blank clearance is Confidential. */
  users?: Record<string, { clearance?: SensitivityLevel; [key: string]: unknown }>
  hierarchy?: {
    /** Exactly 10 top-level folder names when present. */
    topLevel?: string[]
    /** Document type -> route (`"Agreements"` or `"<top-level name>[/<leaf>]"`). */
    routing?: Record<string, string>
  }
  [key: string]: unknown
}

/** `GET /api/workspace` and the `PUT /api/workspace` answer (the stored file). */
export interface WorkspaceFileResponse {
  workspace: WorkspaceFile
  /** sha256 (hex) of workspace.json's bytes; sent back as `If-Match` on save. */
  fileHash: string | null
}
