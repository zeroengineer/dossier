// The brand editor's form model and its conversion to and from brand.json. Ported from the server-rendered settings
// forms (applyBrandSection, removed in v1.0) so a save writes the same file:
// - Top-level keys the form does not edit (layoutProfiles, templateParams, unknown keys) and unknown sub-keys of the
//   edited objects (e.g. `letterhead.x`, `tax.x`) are kept, in their order; the Advanced tab edits the top-level ones as
//   JSON. Rows of lists and maps are rebuilt from their columns, so unknown keys inside a row (a registration, a
//   signatory, a contact entry, a tax mode) are not kept.
// - For a brand with `inheritsFrom`, a blank scalar means "inherit" (the key is left out), a list is written only when
//   its "override" switch is on, and map entries (contacts, strings, ...) merge with the inherited ones key by key.
// - For a root brand, an empty list the file does not have is not added (a file without `tax` stays without it).
// - Values are trimmed and blank rows and lines dropped on save, as the old forms did.
// Validation of the result stays on the server (PUT /api/brands/:id -> WORKSPACE_INVALID with dotted paths);
// `fieldFor` maps those paths back onto form fields.
import type { BrandFile, ResolvedBrand } from "@/api/types"

export interface RegistrationRow { label: string; value: string }
export interface ContactRow { key: string; email: string; phone: string; website: string }
export interface BankRow { accountName: string; bankName: string; accountNumber: string; ifsc: string; swift: string; branch: string }
export interface LineRow { value: string }
export interface PaletteRow { key: string; value: string; useDefault: boolean }
export interface SignatoryRow {
  id: string; name: string; title: string; titleLong: string; email: string; phone: string; signature: string; signatureLarge: string
}
export interface MapRow { key: string; value: string }
export interface TaxModeRow { id: string; label: string; rates: string }

/** A list that an inheriting brand takes whole from its parent unless `override` is on. */
export interface OverridableList<T> { override: boolean; rows: T[] }

export interface BrandFormValues {
  legalName: string
  shortName: string
  projectContact: string
  /** Address lines, one per line of the textarea. */
  addresses: { business: string; registered: string }
  registrations: OverridableList<RegistrationRow>
  contacts: ContactRow[]
  bankAccounts: OverridableList<BankRow>
  letterhead: OverridableList<LineRow>
  footer: { left: string; center: string; right: string }
  palette: PaletteRow[]
  /** Weight -> font spec; "" uses the default (or inherited) font. */
  fonts: Record<string, string>
  assets: { logo: string; seal: string; watermark: string }
  signatories: OverridableList<SignatoryRow>
  defaultSignatory: MapRow[]
  strings: MapRow[]
  tax: { modes: OverridableList<TaxModeRow>; defaultMode: string; defaultHsn: string }
  series: MapRow[]
  /** The top-level keys no tab edits, as a JSON object. */
  advanced: string
}

/** What the conversion needs besides the file: the resolved brand and, for an inheriting brand, its resolved parent. */
export interface BrandContext {
  resolved: ResolvedBrand
  parent: ResolvedBrand | null
  fontWeights: string[]
}

/** Top-level keys edited by the tabs (everything else goes to the Advanced tab). */
export const EDITED_KEYS = [
  "id", "inheritsFrom", "legalName", "shortName", "projectContact", "addresses", "registrations", "contacts",
  "bankAccounts", "letterhead", "footer", "palette", "fonts", "assets", "signatories", "defaultSignatory", "strings",
  "tax", "series",
] as const

const MAP_KEY = /^[A-Za-z0-9_-]+$/
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const BANK_KEYS = ["accountName", "bankName", "accountNumber", "ifsc", "swift", "branch"] as const
const SIGNATORY_KEYS = ["id", "name", "title", "titleLong", "email", "phone", "signature", "signatureLarge"] as const

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
const at = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (isObj(o) ? o[k] : Array.isArray(o) ? o[Number(k)] : undefined), obj)
const objOf = (v: unknown): Obj => (isObj(v) ? v : {})
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const linesText = (v: unknown) => listOf(v).map(str).join("\n")
const linesOf = (text: string) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

/** `label = rate` lines of a tax mode's rates. */
export const ratesText = (rates: unknown) =>
  listOf(rates).map((r) => `${str(at(r, "label"))} = ${str(at(r, "rate"))}`).join("\n")

/**
 * Parse `label = 0.09` / `label = 9%` lines (a percentage becomes a fraction). Returns null when a line has no valid
 * rate.
 */
export function parseRates(text: string): Array<{ label: string; rate: number }> | null {
  const out: Array<{ label: string; rate: number }> = []
  for (const line of linesOf(text)) {
    const i = line.lastIndexOf("=")
    const label = i < 0 ? line : line.slice(0, i).trim()
    const raw = i < 0 ? "" : line.slice(i + 1).trim()
    const pct = raw.endsWith("%")
    const n = Number(pct ? raw.slice(0, -1) : raw)
    if (raw === "" || !Number.isFinite(n)) return null
    out.push({ label, rate: pct ? Math.round(n * 1e6) / 1e8 : n })
  }
  return out
}

/** True when the brand inherits from another one. */
export const inheritsOf = (file: BrandFile) => typeof file.inheritsFrom === "string" && file.inheritsFrom !== ""

function overridable<T>(file: BrandFile, parent: ResolvedBrand | null, path: string, row: (v: unknown) => T): OverridableList<T> {
  const own = at(file, path)
  if (!inheritsOf(file)) return { override: true, rows: listOf(own).map(row) }
  if (own !== undefined) return { override: true, rows: listOf(own).map(row) }
  return { override: false, rows: listOf(at(parent, path)).map(row) }
}

const mapRows = (v: unknown): MapRow[] => Object.entries(objOf(v)).map(([key, value]) => ({ key, value: str(value) }))

/** Palette colour names in display order: the resolved ones (defaults included), then any extra own or parent ones. */
export function paletteKeys(file: BrandFile, ctx: BrandContext): string[] {
  return [...new Set([...Object.keys(ctx.resolved.palette ?? {}), ...Object.keys(objOf(file["palette"])), ...Object.keys(ctx.parent?.palette ?? {})])]
}

/**
 * The value a blank or "use default" field falls back to: the parent's value for an inheriting brand, else the
 * resolved value when the brand does not set the key itself (that is the schema default). Undefined when unknown.
 */
export function fallbackOf(file: BrandFile, ctx: BrandContext, path: string): unknown {
  if (inheritsOf(file)) return at(ctx.parent, path)
  return at(file, path) === undefined ? at(ctx.resolved, path) : undefined
}

/** A value of the resolved parent brand (undefined without a parent). */
export const parentValue = (ctx: BrandContext, path: string): unknown => at(ctx.parent, path)

/** The form values of a brand file. */
export function toFormValues(file: BrandFile, ctx: BrandContext): BrandFormValues {
  const extra: Obj = {}
  for (const [k, v] of Object.entries(file)) if (!(EDITED_KEYS as readonly string[]).includes(k)) extra[k] = v
  const ownPalette = objOf(file["palette"])
  return {
    legalName: str(file["legalName"]),
    shortName: str(file["shortName"]),
    projectContact: str(file["projectContact"]),
    addresses: { business: linesText(at(file, "addresses.business")), registered: linesText(at(file, "addresses.registered")) },
    registrations: overridable(file, ctx.parent, "registrations", (r) => ({ label: str(at(r, "label")), value: str(at(r, "value")) })),
    contacts: Object.entries(objOf(file["contacts"])).map(([key, c]) => ({
      key, email: str(at(c, "email")), phone: str(at(c, "phone")), website: str(at(c, "website")),
    })),
    bankAccounts: overridable(file, ctx.parent, "bankAccounts", (r) =>
      Object.fromEntries(BANK_KEYS.map((k) => [k, str(at(r, k))])) as unknown as BankRow),
    letterhead: overridable(file, ctx.parent, "letterhead.lines", (v) => ({ value: str(v) })),
    footer: { left: str(at(file, "footer.left")), center: str(at(file, "footer.center")), right: str(at(file, "footer.right")) },
    palette: paletteKeys(file, ctx).map((key) => {
      const own = ownPalette[key]
      const fallback = str(fallbackOf(file, ctx, `palette.${key}`))
      return { key, value: own !== undefined ? str(own) : fallback, useDefault: own === undefined }
    }),
    fonts: Object.fromEntries(ctx.fontWeights.map((w) => [w, str(at(file, `fonts.${w}`))])),
    assets: { logo: str(at(file, "assets.logo")), seal: str(at(file, "assets.seal")), watermark: str(at(file, "assets.watermark")) },
    signatories: overridable(file, ctx.parent, "signatories", (r) =>
      Object.fromEntries(SIGNATORY_KEYS.map((k) => [k, str(at(r, k))])) as unknown as SignatoryRow),
    defaultSignatory: mapRows(file["defaultSignatory"]),
    strings: mapRows(file["strings"]),
    tax: {
      modes: overridable(file, ctx.parent, "tax.modes", (m) => ({ id: str(at(m, "id")), label: str(at(m, "label")), rates: ratesText(at(m, "rates")) })),
      defaultMode: str(at(file, "tax.defaultMode")),
      defaultHsn: str(at(file, "tax.defaultHsn")),
    },
    series: Object.entries(objOf(file["series"])).map(([key, value]) => ({ key, value: str(value) })),
    advanced: JSON.stringify(extra, null, 2),
  }
}

/** A problem found while building the file, on a form field path. */
export interface FormProblem { field: string; message: string }

export interface BuildResult {
  body: BrandFile
  /** Problems the form can see before saving (bad map keys, colours, rates, JSON). Nothing is sent while there are any. */
  problems: FormProblem[]
  /** The form field of a server error path (`registrations.1.label`, `contacts.hr.email`), or null for a file-level error. */
  fieldFor: (serverPath: string) => string | null
}

/** Set (or, for undefined, delete) a nested key; parents emptied by a delete are removed. */
function setPath(obj: Obj, path: string, value: unknown) {
  const segs = path.split(".")
  const parents: Array<[Obj, string]> = []
  let node = obj
  for (const s of segs.slice(0, -1)) {
    if (!isObj(node[s])) {
      if (value === undefined) return
      node[s] = {}
    }
    parents.push([node, s])
    node = node[s] as Obj
  }
  const last = segs[segs.length - 1] as string
  if (value === undefined) delete node[last]
  else node[last] = value
  if (value !== undefined) return
  for (let i = parents.length - 1; i >= 0; i--) {
    const [p, k] = parents[i] as [Obj, string]
    if (isObj(p[k]) && Object.keys(p[k]).length === 0) delete p[k]
    else break
  }
}

const trimRow = <T extends object>(row: T): Record<keyof T, string> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v.trim() : ""])) as Record<keyof T, string>
const isBlank = (row: Record<string, string>) => Object.values(row).every((v) => v === "")
const compact = (row: Record<string, string>) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ""))

/** Non-blank rows with the form index of each, so server indexes map back to the right row. */
function keptRows<T extends object>(rows: T[]): Array<{ row: Record<keyof T, string>; index: number }> {
  return rows.map((r, index) => ({ row: trimRow(r), index })).filter(({ row }) => !isBlank(row as Record<string, string>))
}

/**
 * Build the brand.json to save from the form: a copy of `base` (the stored file) with every edited key replaced, and
 * the Advanced JSON's keys in place of the other top-level keys.
 */
export function toBrandFile(values: BrandFormValues, base: BrandFile): BuildResult {
  const inherits = inheritsOf(base)
  const body = structuredClone(base) as Obj
  const problems: FormProblem[] = []
  const indexes: Record<string, number[]> = {}
  const mapIndexes: Record<string, Record<string, number>> = {}

  const scalar = (path: string, value: string, required = false) => {
    const v = value.trim()
    setPath(body, path, v === "" && (inherits || !required) ? undefined : v)
  }
  const list = <T extends object>(name: string, path: string, l: OverridableList<T>, toItem: (row: Record<keyof T, string>, index: number) => unknown) => {
    const kept = keptRows(l.rows)
    indexes[name] = kept.map((k) => k.index)
    const items = kept.map((k) => toItem(k.row, k.index))
    // A root brand writes its list, except an empty one the file does not have (the schema default applies; writing
    // `tax.modes: []` would even fail its min(1)). An inheriting brand writes it only when overriding.
    const write = inherits ? l.override : items.length > 0 || at(base, path) !== undefined
    setPath(body, path, write ? items : undefined)
  }
  /** Rows keyed by `key` -> object; blank rows dropped, bad or duplicate keys reported. */
  const map = <T extends { key: string }>(name: string, rows: T[], valueOf: (row: Record<keyof T, string>) => unknown, keepEmpty = false) => {
    const out: Obj = {}
    const where: Record<string, number> = {}
    for (const { row, index } of keptRows(rows)) {
      if (!MAP_KEY.test(row.key)) problems.push({ field: `${name}.${index}.key`, message: 'key must be letters, digits, "-" or "_"' })
      else if (Object.hasOwn(out, row.key)) problems.push({ field: `${name}.${index}.key`, message: `duplicate key "${row.key}"` })
      else {
        out[row.key] = valueOf(row)
        where[row.key] = index
      }
    }
    mapIndexes[name] = where
    setPath(body, name, Object.keys(out).length || keepEmpty ? out : undefined)
  }

  // Identity and addresses.
  scalar("legalName", values.legalName, true)
  scalar("shortName", values.shortName, true)
  scalar("projectContact", values.projectContact)
  const business = linesOf(values.addresses.business)
  setPath(body, "addresses.business", business.length ? business : inherits ? undefined : [])
  const registered = linesOf(values.addresses.registered)
  setPath(body, "addresses.registered", registered.length ? registered : undefined)

  // Lists.
  list("registrations", "registrations", values.registrations, (r) => ({ label: r.label, value: r.value }))
  list("bankAccounts", "bankAccounts", values.bankAccounts, (r) => compact(r))
  list("letterhead", "letterhead.lines", values.letterhead, (r) => r.value)
  list("signatories", "signatories", values.signatories, (r) => compact(r))
  list("tax.modes", "tax.modes", values.tax.modes, (r, index) => {
    const rates = parseRates(r.rates)
    if (!rates) problems.push({ field: `tax.modes.rows.${index}.rates`, message: 'write each rate as "label = 0.09" or "label = 9%"' })
    return { id: r.id, label: r.label, rates: rates ?? [] }
  })

  // Maps (an inheriting brand merges them key by key with its parent's).
  map("contacts", values.contacts, ({ key: _key, ...rest }) => compact(rest), !inherits)
  map("defaultSignatory", values.defaultSignatory, (r) => r.value)
  map("strings", values.strings, (r) => r.value)
  map("series", values.series, (r) => r.value)

  // Footer, tax scalars, assets, fonts.
  for (const slot of ["left", "center", "right"] as const) scalar(`footer.${slot}`, values.footer[slot])
  scalar("tax.defaultMode", values.tax.defaultMode)
  scalar("tax.defaultHsn", values.tax.defaultHsn)
  for (const slot of ["logo", "seal", "watermark"] as const) scalar(`assets.${slot}`, values.assets[slot])
  for (const [w, v] of Object.entries(values.fonts)) setPath(body, `fonts.${w}`, v.trim() || undefined)

  // Palette: a ticked "default" leaves the colour out.
  values.palette.forEach((p, i) => {
    const v = p.value.trim()
    if (p.useDefault) setPath(body, `palette.${p.key}`, undefined)
    else if (!HEX.test(v)) problems.push({ field: `palette.${i}.value`, message: "must be a hex colour like #1a1a1a" })
    else setPath(body, `palette.${p.key}`, v.toLowerCase())
  })

  // Advanced: the other top-level keys.
  let extra: unknown
  try {
    extra = JSON.parse(values.advanced.trim() || "{}")
  } catch (err) {
    problems.push({ field: "advanced", message: `not valid JSON (${err instanceof Error ? err.message : String(err)})` })
  }
  if (extra !== undefined) {
    if (!isObj(extra)) problems.push({ field: "advanced", message: "must be a JSON object" })
    else {
      const clash = Object.keys(extra).filter((k) => (EDITED_KEYS as readonly string[]).includes(k))
      if (clash.length) problems.push({ field: "advanced", message: `${clash.map((k) => `"${k}"`).join(", ")} ${clash.length > 1 ? "are" : "is"} edited on its own tab` })
      else {
        // In place: kept keys keep their position in the file, removed ones go, new ones are appended.
        for (const k of Object.keys(body)) if (!(EDITED_KEYS as readonly string[]).includes(k) && !Object.hasOwn(extra, k)) delete body[k]
        for (const [k, v] of Object.entries(extra)) body[k] = v
      }
    }
  }

  const row = (name: string, i: string | undefined) => (i === undefined ? undefined : indexes[name]?.[Number(i)])
  const fieldFor = (serverPath: string): string | null => {
    const [head = "", a, b] = serverPath.split(".")
    const listField = (name: string, formName: string, fields: readonly string[], defaultField: string) => {
      const r = row(name, a)
      if (r === undefined) return `${formName}.rows.root`
      return `${formName}.rows.${r}.${b !== undefined && fields.includes(b) ? b : defaultField}`
    }
    const mapField = (name: string, valueField: string, fields: readonly string[] = [valueField]) => {
      const r = a === undefined ? undefined : mapIndexes[name]?.[a]
      if (r === undefined) return `${name}.root`
      return `${name}.${r}.${b !== undefined && fields.includes(b) ? b : valueField}`
    }
    switch (head) {
      case "legalName":
      case "shortName":
      case "projectContact":
        return head
      case "addresses":
        return a === "registered" ? "addresses.registered" : "addresses.business"
      case "registrations":
        return listField("registrations", "registrations", ["label", "value"], "label")
      case "bankAccounts":
        return listField("bankAccounts", "bankAccounts", BANK_KEYS, "accountName")
      case "signatories":
        return listField("signatories", "signatories", SIGNATORY_KEYS, "id")
      case "letterhead": {
        const r = row("letterhead", b)
        return r === undefined ? "letterhead.rows.root" : `letterhead.rows.${r}.value`
      }
      case "footer":
        return a === "left" || a === "center" || a === "right" ? `footer.${a}` : null
      case "contacts":
        return mapField("contacts", "email", ["email", "phone", "website"])
      case "defaultSignatory":
      case "strings":
      case "series":
        return mapField(head, "value")
      case "palette": {
        const i = values.palette.findIndex((p) => p.key === a)
        return i < 0 ? null : `palette.${i}.value`
      }
      case "fonts":
        return a !== undefined && Object.hasOwn(values.fonts, a) ? `fonts.${a}` : null
      case "assets":
        return a === "logo" || a === "seal" || a === "watermark" ? `assets.${a}` : null
      case "tax": {
        if (a === "defaultMode" || a === "defaultHsn") return `tax.${a}`
        if (a !== "modes") return "tax.defaultMode"
        const [, , i, f] = serverPath.split(".")
        const r = row("tax.modes", i)
        if (r === undefined) return "tax.modes.rows.root"
        return `tax.modes.rows.${r}.${f === "id" || f === "label" ? f : f === "rates" ? "rates" : "id"}`
      }
      case "id":
      case "inheritsFrom":
      case "(root)":
      case "":
        return null
      default:
        return "advanced"
    }
  }

  return { body: body as BrandFile, problems, fieldFor }
}

/** Which tab shows a form field (by its first path segment). */
export const TAB_OF_FIELD: Record<string, string> = {
  legalName: "identity",
  shortName: "identity",
  projectContact: "identity",
  addresses: "addresses",
  registrations: "registrations",
  contacts: "contacts",
  bankAccounts: "bank",
  letterhead: "letterhead",
  footer: "footer",
  palette: "palette",
  fonts: "fonts",
  assets: "assets",
  signatories: "signatories",
  defaultSignatory: "signatories",
  strings: "strings",
  tax: "tax",
  series: "series",
  advanced: "advanced",
}

/** The new brand.json of the create dialog (port of the removed server form's newBrandBody): an inheriting brand writes only what was filled in. */
export interface NewBrandValues {
  id: string
  inheritsFrom: string
  legalName: string
  shortName: string
  business: string
  email: string
  phone: string
  website: string
}

export function newBrandFile(v: NewBrandValues): BrandFile {
  const t = trimRow(v)
  const body: BrandFile = { id: t.id }
  const parent = t.inheritsFrom
  if (parent) body.inheritsFrom = parent
  if (t.legalName || !parent) body["legalName"] = t.legalName
  if (t.shortName || !parent) body["shortName"] = t.shortName
  const business = linesOf(v.business)
  if (business.length || !parent) body["addresses"] = { business }
  const contact = compact({ email: t.email, phone: t.phone, website: t.website })
  if (Object.keys(contact).length || !parent) body["contacts"] = { default: contact }
  return body
}

/** Server path of a create-dialog error -> the dialog's field. */
export function newBrandFieldFor(serverPath: string): keyof NewBrandValues | null {
  const [head = "", a, b] = serverPath.split(".")
  if (head === "id" || head === "inheritsFrom" || head === "legalName" || head === "shortName") return head
  if (head === "addresses") return "business"
  if (head === "contacts" && a === "default" && (b === "email" || b === "phone" || b === "website")) return b
  if (head === "contacts") return "email"
  return null
}
