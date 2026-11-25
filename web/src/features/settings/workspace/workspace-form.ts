// workspace.json <-> the workspace form (name, default brand, locale, folder hierarchy, users). Values are trimmed on
// save; a blank locale value is left out (the server's default applies); blank routing and user rows are dropped.
// Keys the form does not edit are kept from the stored file. The server reports problems at workspace.json paths
// (`locale.currencyCode`, `hierarchy.topLevel.3`, `hierarchy.routing.<type>`, `users.<id>.clearance`); `fieldFor`
// maps them back onto form fields.
import type { WorkspaceFile } from "@/api/types"

/** Locale keys on the form, under `locale.`. */
export const LOCALE_PATHS = [
  "currencySymbol", "currencyCode", "numberLocale", "dateFormats.short", "dateFormats.long", "dateFormats.us",
  "currencyWords.major", "currencyWords.minor", "currencyWords.suffix",
] as const

/** Number of top-level folders (`hierarchy.topLevel` lists exactly this many names when present). */
export const TOP_LEVEL_COUNT = 10

export interface WorkspaceFormValues {
  name: string
  defaultBrand: string
  locale: {
    currencySymbol: string
    currencyCode: string
    numberLocale: string
    dateFormats: { short: string; long: string; us: string }
    currencyWords: { major: string; minor: string; suffix: string }
  }
  hierarchy: {
    /** Always TOP_LEVEL_COUNT slots; all blank = the default names. */
    topLevel: Array<{ value: string }>
    routing: Array<{ type: string; value: string }>
  }
  users: Array<{ id: string; clearance: string }>
}

export const BLANK_ROUTE = { type: "", value: "" }
export const BLANK_USER = { id: "", clearance: "" }

export interface WorkspaceBuild {
  body: WorkspaceFile
  problems: Array<{ field: string; message: string }>
  fieldFor: (serverPath: string) => string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : "")
const at = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), obj)

/** Set a nested key, or (for `undefined`) delete it and remove the parents that delete left empty. */
function setPath(obj: Obj, path: string, value: string | undefined) {
  const segs = path.split(".")
  const last = segs.pop() as string
  const parents: Array<[Obj, string]> = []
  let node = obj
  for (const s of segs) {
    if (!isObj(node[s])) {
      if (value === undefined) return
      node[s] = {}
    }
    parents.push([node, s])
    node = node[s] as Obj
  }
  if (value !== undefined) {
    node[last] = value
    return
  }
  if (!(last in node)) return
  delete node[last]
  for (const [parent, key] of parents.reverse()) {
    if (Object.keys(parent[key] as Obj).length) break
    delete parent[key]
  }
}

export function toWorkspaceFormValues(file: WorkspaceFile): WorkspaceFormValues {
  const loc = (p: string) => str(at(file.locale, p))
  const top = Array.isArray(file.hierarchy?.topLevel) ? file.hierarchy.topLevel : []
  return {
    name: str(file.name),
    defaultBrand: str(file.defaultBrand),
    locale: {
      currencySymbol: loc("currencySymbol"),
      currencyCode: loc("currencyCode"),
      numberLocale: loc("numberLocale"),
      dateFormats: { short: loc("dateFormats.short"), long: loc("dateFormats.long"), us: loc("dateFormats.us") },
      currencyWords: { major: loc("currencyWords.major"), minor: loc("currencyWords.minor"), suffix: loc("currencyWords.suffix") },
    },
    hierarchy: {
      topLevel: Array.from({ length: TOP_LEVEL_COUNT }, (_, i) => ({ value: str(top[i]) })),
      routing: Object.entries(isObj(file.hierarchy?.routing) ? file.hierarchy.routing : {}).map(([type, value]) => ({ type, value: str(value) })),
    },
    users: Object.entries(isObj(file.users) ? file.users : {}).map(([id, u]) => ({ id, clearance: str(isObj(u) ? u["clearance"] : "") })),
  }
}

const USER_ID = /^[A-Za-z0-9._@-]+$/

/**
 * A routing value that starts with a stored custom top-level name (`"06 Money/Bank Statements"`) follows that folder's
 * rename; otherwise the server would no longer recognise the prefix and file the type inside the party's folder.
 * Default names always stay recognised, so values using them are left alone.
 */
function renamedRoute(value: string, storedTop: string[] | null, newTop: string[], defaults: string[]): string {
  if (!storedTop) return value
  for (let i = 0; i < storedTop.length; i++) {
    const old = storedTop[i]
    const next = newTop[i]
    if (!old || !next || old === next || old === defaults[i]) continue
    if (value === old) return next
    if (value.startsWith(`${old}/`)) return `${next}${value.slice(old.length)}`
  }
  return value
}

/**
 * The workspace.json to save. `defaultTopLevel` (from `/api/meta`) fills top-level names left blank when at least one
 * is set, so the list always has its ten names.
 */
export function toWorkspaceFile(values: WorkspaceFormValues, base: WorkspaceFile, defaultTopLevel: string[]): WorkspaceBuild {
  const body = structuredClone(base) as Obj
  const problems: WorkspaceBuild["problems"] = []
  body["name"] = values.name.trim()
  body["defaultBrand"] = values.defaultBrand.trim()

  for (const p of LOCALE_PATHS) {
    const v = str(at(values.locale, p)).trim()
    setPath(body, `locale.${p}`, v === "" ? undefined : v)
  }

  // Hierarchy: the ten names (or none), routing rows keyed by document type.
  const hierarchy: Obj = isObj(body["hierarchy"]) ? body["hierarchy"] : {}
  const names = values.hierarchy.topLevel.map((t) => t.value.trim())
  const storedTop = Array.isArray(base.hierarchy?.topLevel) && base.hierarchy.topLevel.length === TOP_LEVEL_COUNT ? base.hierarchy.topLevel : null
  let newTop: string[] = defaultTopLevel
  if (names.every((n) => n === "")) delete hierarchy["topLevel"]
  else {
    newTop = names.map((n, i) => n || (defaultTopLevel[i] ?? ""))
    hierarchy["topLevel"] = newTop
    names.forEach((n, i) => {
      if (!n) return
      const field = `hierarchy.topLevel.${i}.value`
      if (n.includes("/")) problems.push({ field, message: 'must not contain "/"' })
      else if (newTop.some((other, j) => j !== i && other === n)) problems.push({ field, message: `duplicate folder name "${n}"` })
    })
  }
  const routing: Record<string, string> = {}
  const routeRow = new Map<string, number>()
  const routeKeys = new Set<string>()
  values.hierarchy.routing.forEach((r, i) => {
    const type = r.type.trim()
    const value = r.value.trim()
    if (!type && !value) return
    // The server matches types case-insensitively with spaces collapsed.
    const key = type.replace(/\s+/g, " ").toLowerCase()
    if (!type) problems.push({ field: `hierarchy.routing.${i}.type`, message: "enter the document type" })
    else if (routeKeys.has(key)) problems.push({ field: `hierarchy.routing.${i}.type`, message: `duplicate document type "${type}"` })
    else {
      routing[type] = renamedRoute(value, storedTop, newTop, defaultTopLevel)
      routeRow.set(type, i)
      routeKeys.add(key)
    }
  })
  if (Object.keys(routing).length) hierarchy["routing"] = routing
  else delete hierarchy["routing"]
  if (Object.keys(hierarchy).length || "hierarchy" in base) body["hierarchy"] = hierarchy

  // Users: id -> { clearance }, other keys of a stored user kept.
  const storedUsers: Obj = isObj(base.users) ? base.users : {}
  const users: Obj = {}
  const userRow = new Map<string, number>()
  values.users.forEach((r, i) => {
    const id = r.id.trim()
    const clearance = r.clearance.trim()
    if (!id && !clearance) return
    if (!id) problems.push({ field: `users.${i}.id`, message: "enter the user id" })
    else if (!USER_ID.test(id)) problems.push({ field: `users.${i}.id`, message: 'user id must be letters, digits, ".", "_", "@" or "-"' })
    else if (userRow.has(id)) problems.push({ field: `users.${i}.id`, message: `duplicate user "${id}"` })
    else {
      const { clearance: _old, ...rest } = isObj(storedUsers[id]) ? (storedUsers[id] as Obj) : {}
      users[id] = clearance ? { ...rest, clearance } : rest
      userRow.set(id, i)
    }
  })
  if (Object.keys(users).length || "users" in base) body["users"] = users

  const fieldFor = (serverPath: string): string | null => {
    if (serverPath === "name" || serverPath === "defaultBrand") return serverPath
    if (serverPath.startsWith("locale.")) return (LOCALE_PATHS as readonly string[]).includes(serverPath.slice(7)) ? serverPath : null
    if (serverPath === "hierarchy.topLevel" || serverPath === "hierarchy") return "hierarchy.topLevel.root"
    const top = /^hierarchy\.topLevel\.(\d+)$/.exec(serverPath)
    if (top) return Number(top[1]) < TOP_LEVEL_COUNT ? `hierarchy.topLevel.${top[1]}.value` : "hierarchy.topLevel.root"
    if (serverPath === "hierarchy.routing") return "hierarchy.routing.root"
    if (serverPath.startsWith("hierarchy.routing.")) {
      const row = routeRow.get(serverPath.slice("hierarchy.routing.".length))
      return row === undefined ? null : `hierarchy.routing.${row}.value`
    }
    if (serverPath === "users") return "users.root"
    const user = /^users\.(.+?)(?:\.clearance)?$/.exec(serverPath)
    if (user) {
      const row = userRow.get(user[1] ?? "")
      return row === undefined ? null : `users.${row}.clearance`
    }
    return null
  }
  return { body: body as WorkspaceFile, problems, fieldFor }
}

/**
 * The clearance levels the acting user would lose by saving `body` (empty when theirs stays or rises). Their clearance
 * in `body` is the listed one; an unlisted user or a blank clearance is Confidential. `clearances` is `meta.clearances`,
 * lowest first. Used only to warn: once lowered, the server's clearance rule stops them raising it back themselves.
 */
export function lostClearances(body: WorkspaceFile, userId: string, current: string, clearances: string[]): string[] {
  const entry = isObj(body.users) ? body.users[userId] : undefined
  const after = (isObj(entry) && typeof entry["clearance"] === "string" && entry["clearance"]) || "Confidential"
  const from = clearances.indexOf(after)
  const to = clearances.indexOf(current)
  if (from < 0 || to < 0 || from >= to) return []
  return clearances.slice(from + 1, to + 1)
}
