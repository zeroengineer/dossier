import { z } from "zod"
import { ApiError, errorMessage } from "@/lib/api"
import type { SensitivityLevel } from "@/api/types"

/** Metadata of a new document. Empty strings are left out of the request so the server's defaults apply. */
export const newDocumentSchema = z.object({
  type: z.string().trim().min(1, "Choose a document type"),
  title: z.string(),
  partyId: z.string(),
  partyType: z.string(),
  docNumber: z.string(),
  numberSeries: z.string(),
  docDate: z.string(),
  dueDate: z.string(),
  amount: z.string(),
  currency: z.string(),
  status: z.string(),
  sensitivity: z.string(),
})
export type NewDocumentValues = z.infer<typeof newDocumentSchema>

/** A new version of an existing document. */
export const newVersionSchema = z.object({
  note: z.string(),
  makeCurrent: z.boolean(),
})
export type NewVersionValues = z.infer<typeof newVersionSchema>

/** Every metadata field the upload form sends, in the order of the form. */
export const NEW_DOCUMENT_FIELDS = Object.keys(newDocumentSchema.shape) as Array<keyof NewDocumentValues>

/** The multipart body for `POST /api/upload`: the file plus every non-blank text field (trimmed). */
export function toUploadFormData(file: File, fields: Record<string, string | boolean>): FormData {
  const body = new FormData()
  for (const [key, raw] of Object.entries(fields)) {
    const value = typeof raw === "boolean" ? String(raw) : raw.trim()
    if (value !== "") body.append(key, value)
  }
  body.append("file", file, file.name)
  return body
}

/** Sensitivity levels the user may file: every level up to and including their clearance (order from `/api/meta`). */
export function levelsWithin(levels: SensitivityLevel[], clearance: SensitivityLevel | undefined): SensitivityLevel[] {
  if (!clearance) return levels
  const max = levels.indexOf(clearance)
  return max < 0 ? levels : levels.slice(0, max + 1)
}

const MB = 1024 * 1024

/** `52428800` → `50 MB`; smaller limits keep one decimal (`1.5 MB`), under 1 MB in KB. */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) {
    const mb = bytes / MB
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function tooLargeMessage(limit: number | undefined): string {
  return limit ? `The file is larger than the ${formatBytes(limit)} upload limit. Choose a smaller file.` : "The file is larger than the server's upload limit. Choose a smaller file."
}

/** True for the server's size-limit answer (413 PAYLOAD_TOO_LARGE from the multipart file-size limit). */
export function isTooLarge(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 413 || err.code === "PAYLOAD_TOO_LARGE")
}

/** The message to show for a failed upload: a plain sentence for the size limit, `CODE: message` otherwise. */
export function uploadErrorMessage(err: unknown, limit: number | undefined): string {
  return isTooLarge(err) ? tooLargeMessage(limit) : errorMessage(err)
}

/** Field names an upload error points at: `details` keys the server echoes back (`{ currency: "inr" }`). */
export function erroredFields<K extends string>(err: unknown, fields: readonly K[]): K[] {
  if (!(err instanceof ApiError)) return []
  const named = new Set(Object.keys(err.details))
  // uploadMeta reports a bad amount as `amount`; createDocument reports it as `amountMinor`.
  if (named.has("amountMinor")) named.add("amount")
  for (const e of err.fieldErrors) if (e.path) named.add(e.path)
  return fields.filter((f) => named.has(f))
}

/** A short human label for an upload warning code (the toast title). */
export function warningTitle(code: string): string {
  if (code === "NUMBER_CONFLICT") return "Number conflict"
  const words = code.toLowerCase().replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A readable line for each upload warning code. */
export function warningMessage(code: string, docNumber: string | null, series: string | null): string {
  if (code === "NUMBER_CONFLICT") {
    const what = docNumber ? `Number ${docNumber}` : "The number"
    return `${what} is already used${series ? ` in series ${series}` : ""}. The document is flagged with a number conflict.`
  }
  return code
}
