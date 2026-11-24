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
