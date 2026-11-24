import type { FieldValues, Path, UseFormSetError } from "react-hook-form"
import { ApiError, type FieldError } from "@/lib/api"

/** A field error the form could not place on a field (file-level, another file's, or an unknown path). */
export interface UnplacedError {
  /** `file path: message` / `path: message` / `message`, ready to list in an Alert. */
  text: string
}

/**
 * Put an API error's field errors (`details.errors[]`, e.g. WORKSPACE_INVALID) onto form fields with `setError`.
 * `fieldFor` maps a server path to a form field name (null: not a field). Errors about another file than `file` are
 * never placed on fields. Returns the fields that were set (first one first) and the errors left over; a non-API
 * error or one without field errors comes back as nothing placed.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fieldFor: (serverPath: string) => string | null,
  file?: string,
): { placed: string[]; unplaced: UnplacedError[] } {
  const placed: string[] = []
  const unplaced: UnplacedError[] = []
  if (!(err instanceof ApiError)) return { placed, unplaced }
  for (const e of err.fieldErrors) {
    const other = otherFile(e, file)
    const field = !other && e.path ? fieldFor(e.path) : null
    if (field) {
      setError(field as Path<T>, { type: "server", message: e.message })
      placed.push(field)
    } else {
      unplaced.push({ text: `${other ? `${other} ` : ""}${e.path ? `${e.path}: ` : ""}${e.message}` })
    }
  }
  return { placed, unplaced }
}

/** The error's `file` when it names a different file than `file`. */
function otherFile(e: FieldError, file: string | undefined): string | null {
  const raw = e.raw
  if (!file || typeof raw !== "object" || raw === null) return null
  const f = (raw as { file?: unknown }).file
  return typeof f === "string" && f !== file ? f : null
}
