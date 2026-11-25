import type { TemplateField } from "@/api/types"

/**
 * Generate form values: nested by the dotted field names (`billTo.name` -> `{ billTo: { name } }`, the way
 * react-hook-form stores them). Scalars are strings (money stays a string: the backend coerces it), switches booleans,
 * list rows objects of strings, and lists without row columns / objects the text of their textarea.
 */
export type FormValues = Record<string, unknown>

/** A value the form could not turn into input (shown on the field, like the server's FIELDS_INVALID entries). */
export interface InputProblem {
  name: string
  message: string
}

export const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)

/** Read a dotted path (`items.0.amount`) through objects and arrays; undefined when any step is missing. */
export function getPath(obj: unknown, path: string): unknown {
  let v: unknown = obj
  for (const k of path.split(".")) {
    if (isObj(v) && Object.hasOwn(v, k)) v = v[k]
    else if (Array.isArray(v) && Object.hasOwn(v, k)) v = v[Number(k)]
    else return undefined
  }
  return v
}

/** Set (or with `undefined`, delete) a dotted path whose parent objects exist; does nothing when they do not. */
function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.split(".")
  let node = obj
  for (const s of segs.slice(0, -1)) {
    const next = node[s]
    if (!isObj(next)) return // nothing entered under this path
    node = next
  }
  const last = segs[segs.length - 1] as string
  if (value === undefined) delete node[last]
  else node[last] = value
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "")

/**
 * What a list-or-object textarea holds, read the way the removed server form's `formToInput` read it: blank is no value, text
 * starting with `[` or `{` is JSON, other text is one list entry per line (lists only; an object must be JSON).
 */
export function parseStructured(
  field: Pick<TemplateField, "type">,
  text: string,
): { value: unknown } | { error: string } {
  const s = text.trim()
  if (s === "") return { value: undefined }
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      return { value: JSON.parse(s) as unknown }
    } catch (e) {
      return { error: `not valid JSON (${e instanceof Error ? e.message : String(e)})` }
    }
  }
  if (field.type === "array") return { value: s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) }
  return { error: "expected a JSON object" }
}

/** Drop object keys whose value is undefined (switches left at no default), so the input is plain JSON. */
function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune)
  if (isObj(v)) {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, prune(x)]))
  }
  return v
}

/**
 * Turn generate form values into `input` for `/api/templates/:id/{preview,generate}`: a port of the removed
 * server-rendered form's `formToInput`. List rows with every cell blank are dropped (an empty list is left out);
 * a list without row columns and an object field are a textarea holding JSON, or (lists) one entry per line. Blank
 * scalars stay `''` (the server treats them as not provided and applies sources and defaults).
 *
 * `rowIndex` maps each list field to the form row of every row sent (`rowIndex.items[1] === 2`: the second row in the
 * input is the form's third). Pass it to `remapErrorPath` before putting a server error such as `items.1.amount` on
 * the form, since blank rows before it were dropped.
 */
export function toInput(fields: readonly TemplateField[], values: FormValues): InputResult {
  const input = prune(structuredClone(values)) as Record<string, unknown>
  const errors: InputProblem[] = []
  const rowIndex: RowIndex = {}
  for (const f of fields) {
    const v = getPath(input, f.name)
    if (v === undefined) continue
    if (f.type === "array" && f.item) {
      const kept: number[] = []
      const rows = (Array.isArray(v) ? v : []).filter((r, i) => {
        const keep = isObj(r) && Object.values(r).some((x) => !blank(x))
        if (keep) kept.push(i)
        return keep
      })
      rowIndex[f.name] = kept
      setPath(input, f.name, rows.length ? rows : undefined)
    } else if ((f.type === "array" || f.type === "object") && typeof v === "string") {
      const r = parseStructured(f, v)
      if ("error" in r) errors.push({ name: f.name, message: r.error })
      else setPath(input, f.name, r.value)
    }
  }
  return { input, errors, rowIndex }
}

/** List field name -> the form row index of each row sent, in input order (see `toInput`). */
export type RowIndex = Record<string, number[]>

export interface InputResult {
  input: Record<string, unknown>
  errors: InputProblem[]
  rowIndex: RowIndex
}

/**
 * Turn a path the server reported against the sent input (`items.1.amount`) into the form's path (`items.2.amount`
 * when a blank row 0 was dropped). Paths outside list rows come back unchanged.
 */
export function remapErrorPath(path: string, rowIndex: RowIndex): string {
  for (const [name, kept] of Object.entries(rowIndex)) {
    if (!path.startsWith(`${name}.`)) continue
    const [index, ...rest] = path.slice(name.length + 1).split(".")
    if (index === undefined || !/^\d+$/.test(index)) continue
    const formIndex = kept[Number(index)]
    if (formIndex === undefined) continue
    return [name, String(formIndex), ...rest].join(".")
  }
  return path
}
