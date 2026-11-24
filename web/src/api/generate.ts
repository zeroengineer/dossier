import { useQuery } from "@tanstack/react-query"
import { ApiError, request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { ApiErrorBody, EntityMatchList } from "./types"

/** The most entities the API returns in one list (src/services/entities.js MAX_LIMIT). */
const ENTITY_OPTIONS_LIMIT = 500

export const fetchEntityOptions = (kind: string, signal?: AbortSignal) => {
  const q = new URLSearchParams({ kind, limit: String(ENTITY_OPTIONS_LIMIT) })
  return request<EntityMatchList>(`/api/entities?${q}`, { signal })
}

/**
 * Every entity of `kind`, for an entity field's combobox. Keyed under `entities` so creating or editing an entity
 * (prefix invalidation of `keys.entities.all`) refreshes the options.
 */
export function useEntityOptions(kind: string) {
  return useQuery({
    queryKey: keys.entities.list({ kind, limit: ENTITY_OPTIONS_LIMIT, for: "generate" }),
    queryFn: ({ signal }) => fetchEntityOptions(kind, signal),
    staleTime: 60_000,
  })
}

/** What `POST /api/templates/:id/preview` answers (src/web/routes/templates.js previewView). */
export type PreviewResult = PreviewOk | PreviewProblems

/** 200: an unnumbered draft; rendition urls are `/previews/:token/preview.<kind>`. */
export interface PreviewOk {
  ok: true
  token: string
  renditions: { kind: string; bytes: number; url: string }[]
  /** Placeholders that print empty (`PLACEHOLDER_EMPTY` …). */
  warnings: { code?: string; name: string; message: string }[]
}

/**
 * 400 without an error `code`: required fields still empty (`missing`, as FIELDS_MISSING lists them) and values that
 * do not fit (`errors`, as FIELDS_INVALID lists them). Paths are against the sent input: map row paths back to the
 * form with `remapErrorPath` (features/generate/to-input.ts).
 */
export interface PreviewProblems {
  ok: false
  missing: { name: string; label: string; type: string; enum?: string[]; help?: string }[]
  errors: { name: string; message: string }[]
}

export interface PreviewRequest {
  input: Record<string, unknown>
  brandId?: string | null
  /** `YYYY-MM-DD` for `today` sources. */
  today?: string
}

const isPreviewResult = (v: unknown): v is PreviewResult =>
  typeof v === "object" && v !== null && typeof (v as { ok?: unknown }).ok === "boolean"

/**
 * Render a draft. Resolves with the preview body both for 200 and for the 400 that lists missing / invalid fields:
 * that 400 has no `{ code, message }`, so `request()` would turn it into an empty `HTTP_ERROR` and drop the lists.
 * Any other failure (unknown template or brand, a render error, the network) rejects with `ApiError` as usual.
 */
export async function previewTemplate(id: string, body: PreviewRequest, signal?: AbortSignal): Promise<PreviewResult> {
  const { input, brandId, today } = body
  const json = { input, ...(brandId ? { brandId } : {}), ...(today ? { today } : {}) }
  let res: Response
  try {
    res = await fetch(new URL(`/api/templates/${encodeURIComponent(id)}/preview`, window.location.origin), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(json),
      signal,
      credentials: "same-origin",
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "Could not reach the Dossier server", details: {} })
  }
  const parsed: unknown = await res.json().catch(() => null)
  if ((res.ok || res.status === 400) && isPreviewResult(parsed)) return parsed
  const err = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Partial<ApiErrorBody>
  throw new ApiError(res.status, {
    code: typeof err.code === "string" ? err.code : "HTTP_ERROR",
    message: typeof err.message === "string" ? err.message : res.statusText || `Request failed with status ${res.status}`,
    details: typeof err.details === "object" && err.details !== null ? err.details : {},
  })
}
