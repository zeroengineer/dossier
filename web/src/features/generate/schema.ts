import { z } from "zod"
import type { TemplateField, TemplateMetaField } from "@/api/types"
import { type FormValues, getPath, isObj, parseStructured } from "./to-input"

/** How a field is edited. Mirrors the old server-rendered form (src/web/views/generate.js fieldInput). */
export type FieldKind =
  | "entity" // combobox over /api/entities?kind=
  | "enum" // select over `choices`
  | "boolean" // switch
  | "date"
  | "money" // string; the backend coerces it
  | "number"
  | "text" // multi-line text
  | "rows" // list with row columns: one row of inputs per entry
  | "structured" // list or object without row columns: JSON (lists also one entry per line)
  | "lines" // untyped field whose help mentions lines (addresses): multi-line text
  | "string"

export function fieldKind(f: TemplateField): FieldKind {
  if (f.entityKind) return "entity"
  if (f.choices) return "enum"
  switch (f.type) {
    case "boolean":
    case "date":
    case "money":
    case "number":
    case "text":
      return f.type
    case "array":
      return f.item ? "rows" : "structured"
    case "object":
      return "structured"
    case null:
      return (f.help ?? "").toLowerCase().includes("line") ? "lines" : "string"
    default:
      return "string"
  }
}

const metaFieldOf = (metaFields: readonly TemplateMetaField[], name: string) => metaFields.find((m) => m.name === name)

/**
 * Whether the form itself insists on a value. A required field is only enforced here when nothing else can fill it:
 * its source is `ask` (or an entity to pick) and it has no default. Required fields with another source (`today`,
 * `client.name`, the brand's signatory …) are filled by the server when left blank, which reports them as missing if
 * they are still empty.
 */
export function mustFill(f: TemplateField, metaFields: readonly TemplateMetaField[]): boolean {
  if (!f.required) return false
  if (metaFieldOf(metaFields, f.name)?.default !== undefined) return false
  const source = f.source ?? "ask"
  return source === "ask" || source.startsWith("entity:")
}

const REQUIRED = "Required"
const filled = (s: string) => s.trim() !== ""
const rowFilled = (row: unknown) => isObj(row) && Object.values(row).some((x) => typeof x === "string" && filled(x))

function leafSchema(f: TemplateField, required: boolean): z.ZodType {
  const text = required ? z.string().refine(filled, REQUIRED) : z.string()
  switch (fieldKind(f)) {
    case "boolean":
      return z.boolean().optional()
    case "rows": {
      const columns = Object.fromEntries(Object.keys(f.item ?? {}).map((k) => [k, z.string()]))
      const rows = z.array(z.looseObject(columns))
      return required ? rows.refine((list) => list.some(rowFilled), "Add at least one row") : rows
    }
    case "structured":
      return text.superRefine((s, ctx) => {
        const r = parseStructured(f, s)
        if ("error" in r) ctx.addIssue({ code: "custom", message: r.error })
      })
    default:
      return text
  }
}

interface Tree {
  [key: string]: Tree | z.ZodType
}

const isTree = (v: Tree | z.ZodType | undefined): v is Tree => v !== undefined && !(v instanceof z.ZodType)

function treeToSchema(tree: Tree): z.ZodType {
  return z.looseObject(Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, isTree(v) ? treeToSchema(v) : v])))
}

/**
 * The zod schema of a template's generate form, nested by the dotted field names like the form values. Only checks
 * what the form can know: fields nothing else fills are required, list/object textareas must parse (see
 * `parseStructured`). Amounts, numbers, dates and choices are checked by the server.
 */
export function fieldsToZod(fields: readonly TemplateField[], metaFields: readonly TemplateMetaField[] = []) {
  const tree: Tree = {}
  for (const f of fields) {
    const segs = f.name.split(".")
    let node = tree
    for (const s of segs.slice(0, -1)) {
      const next = node[s]
      if (isTree(next)) node = next
      else node = node[s] = {}
    }
    node[segs[segs.length - 1] as string] = leafSchema(f, mustFill(f, metaFields))
  }
  return treeToSchema(tree) as z.ZodType<FormValues, FormValues>
}

/** One empty row of a list field's columns. */
export function blankRow(f: TemplateField): Record<string, string> {
  return Object.fromEntries(Object.keys(f.item ?? {}).map((k) => [k, ""]))
}

/** Text shown in a textarea for a list or object value: one entry per line for a list of strings, else JSON. */
export function listText(v: unknown): string {
  if (v === undefined || v === null) return ""
  if (typeof v === "string") return v
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join("\n")
  return JSON.stringify(v, null, 2)
}

/**
 * Choice fields whose value is not among the field's `choices` (any more): after a brand switch, a brand list such as
 * the tax modes can differ. The form clears them so the Select does not hold a value it cannot show.
 */
export function unofferedChoices(fields: readonly TemplateField[], values: FormValues): TemplateField[] {
  return fields.filter((f) => {
    if (fieldKind(f) !== "enum") return false
    const v = getPath(values, f.name)
    return typeof v === "string" && v !== "" && !(f.choices ?? []).includes(v)
  })
}

/** A scalar as input text; an entity object shows its name. */
function scalarText(v: unknown): string {
  if (v === undefined || v === null) return ""
  if (isObj(v)) return typeof v["name"] === "string" ? v["name"] : ""
  return String(v)
}

function setDeep(obj: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.split(".")
  let node = obj
  for (const s of segs.slice(0, -1)) {
    const next = node[s]
    if (isObj(next)) node = next
    else node = node[s] = {} as Record<string, unknown>
  }
  node[segs[segs.length - 1] as string] = value
}

/**
 * Initial form values for a template: empty fields (one blank row per list), switches at the template's default, or
 * the values of a previous `input` (regenerating a document).
 */
export function toFormValues(
  fields: readonly TemplateField[],
  metaFields: readonly TemplateMetaField[] = [],
  input: Record<string, unknown> = {},
): FormValues {
  const values: FormValues = {}
  for (const f of fields) {
    const v = getPath(input, f.name)
    let value: unknown
    switch (fieldKind(f)) {
      case "boolean": {
        const fallback = metaFieldOf(metaFields, f.name)?.default
        // A required switch starts off rather than unset, so it is always sent.
        value =
          typeof v === "boolean"
            ? v
            : typeof fallback === "boolean"
              ? fallback
              : mustFill(f, metaFields)
                ? false
                : undefined
        break
      }
      case "rows": {
        const columns = Object.keys(f.item ?? {})
        value =
          Array.isArray(v) && v.length
            ? v.map((row) => Object.fromEntries(columns.map((k) => [k, scalarText(isObj(row) ? row[k] : undefined)])))
            : [blankRow(f)]
        break
      }
      case "structured":
      case "lines":
        value = listText(v)
        break
      default:
        value = scalarText(v)
    }
    setDeep(values, f.name, value)
  }
  return values
}
