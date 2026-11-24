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
