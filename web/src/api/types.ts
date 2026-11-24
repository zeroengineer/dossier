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
