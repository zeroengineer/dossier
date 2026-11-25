import type { UseFormReturn } from "react-hook-form"
import type { TemplateField } from "@/api/types"
import { remapErrorPath, type RowIndex, type FormValues } from "./to-input"

/** One field problem in form terms: `path` is a form path (rows already mapped back), `label` what to call it. */
export interface FieldProblem {
  path: string
  label: string
  message: string
  /** A required field left empty (FIELDS_MISSING, preview `missing`), as opposed to a value that does not fit. */
  missing: boolean
}

/** The error type the generate page puts on fields, so it clears only its own errors and leaves the schema's. */
export const SERVER_ERROR = "server"

/**
 * A readable name for a form path: the field's label, plus row and column for a list cell
 * (`items.2.amount` -> "Items row 3 amount").
 */
export function labelOfPath(fields: readonly TemplateField[], path: string): string {
  const field = fields.find((f) => path === f.name) ?? fields.find((f) => path.startsWith(`${f.name}.`))
  if (!field) return path
  if (path === field.name) return field.label
  const [row, ...rest] = path.slice(field.name.length + 1).split(".")
  if (row !== undefined && /^\d+$/.test(row)) {
    return [`${field.label} row ${Number(row) + 1}`, ...rest].join(" ")
  }
  return `${field.label} ${[row, ...rest].join(".")}`
}

interface RawProblems {
  missing?: readonly { name: string; label?: string }[]
  errors?: readonly { name: string; message: string }[]
}

/** The server's missing/invalid lists (paths against the sent input) as form problems. */
export function toFieldProblems(fields: readonly TemplateField[], raw: RawProblems, rowIndex: RowIndex): FieldProblem[] {
  const out: FieldProblem[] = []
  for (const m of raw.missing ?? []) {
    const path = remapErrorPath(m.name, rowIndex)
    out.push({ path, label: m.label || labelOfPath(fields, path), message: "is required", missing: true })
  }
  for (const e of raw.errors ?? []) {
    const path = remapErrorPath(e.name, rowIndex)
    out.push({ path, label: labelOfPath(fields, path), message: e.message, missing: false })
  }
  return out
}

/**
 * Put problems on the form's fields (type `server`), after clearing the `server` errors this page set before. With
 * `missingOnlyIfTouched`, a missing field is marked only once the user has touched or changed it: the live preview must
 * not paint a fresh form red. Returns the paths now carrying a server error.
 */
export function setFieldProblems(
  form: UseFormReturn<FormValues>,
  problems: readonly FieldProblem[],
  previous: readonly string[],
  { missingOnlyIfTouched = false }: { missingOnlyIfTouched?: boolean } = {},
): string[] {
  // Idempotent: a field already showing the same server error is left alone, so calling this again with the same
  // problems changes nothing (no form state update, no re-render loop).
  const wanted = new Map<string, string>()
  for (const p of problems) {
    if (wanted.has(p.path)) continue
    if (p.missing && missingOnlyIfTouched) {
      const state = form.getFieldState(p.path)
      if (!state.isTouched && !state.isDirty) continue
    }
    wanted.set(p.path, p.message)
  }
  for (const path of previous) {
    if (!wanted.has(path) && form.getFieldState(path).error?.type === SERVER_ERROR) form.clearErrors(path)
  }
  const set: string[] = []
  for (const [path, message] of wanted) {
    const current = form.getFieldState(path).error
    // Keep a schema error already on the field (e.g. "Required"): it says the same and clears itself.
    if (current && current.type !== SERVER_ERROR) continue
    if (current?.message !== message) form.setError(path, { type: SERVER_ERROR, message })
    set.push(path)
  }
  return set
}
