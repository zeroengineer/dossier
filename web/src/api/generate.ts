import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, request } from "@/lib/api"
import { keys } from "@/lib/keys"
import { ENTITY_LIST_LIMIT, fetchEntities } from "./entities"
import type { ApiErrorBody, GenerateRequest, GenerateResult } from "./types"
import { treeKeys } from "./vault"

/**
 * Every entity of `kind` (up to the API's ENTITY_LIST_LIMIT), for an entity field's combobox. Keyed under `entities`
 * so creating or editing an entity (prefix invalidation of `keys.entities.all`) refreshes the options.
 */
export function useEntityOptions(kind: string) {
  return useQuery({
    queryKey: keys.entities.list({ kind, limit: ENTITY_LIST_LIMIT, for: "generate" }),
    queryFn: ({ signal }) => fetchEntities({ kind, limit: ENTITY_LIST_LIMIT }, signal),
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

/** Preview query keys under the template (`templates` prefix): one per brand and input. */
export const previewKeys = {
  draft: (id: string, brandId: string | null, inputJson: string) =>
    [...keys.templates.detail(id), "preview", { brandId, input: inputJson }] as const,
  text: (url: string) => [...keys.templates.all, "preview-text", url] as const,
}

/**
 * The draft preview of `inputJson` (the JSON of `toInput(...).input`); idle while `inputJson` is null. A new input
 * cancels the request in flight (the query passes its signal on); the last answer stays on screen while the next loads.
 */
export function usePreview(id: string, brandId: string | null, inputJson: string | null) {
  return useQuery({
    queryKey: previewKeys.draft(id, brandId, inputJson ?? ""),
    queryFn: ({ signal }) =>
      previewTemplate(id, { input: JSON.parse(inputJson ?? "{}") as Record<string, unknown>, brandId }, signal),
    enabled: inputJson !== null,
    placeholderData: keepPreviousData,
    retry: false,
    // The files live under a token on the server: ask again rather than trust an old answer for long.
    staleTime: 30_000,
    gcTime: 60_000,
  })
}

/** A text preview file (Markdown) as a string. */
export function usePreviewText(url: string, enabled = true) {
  return useQuery({
    queryKey: previewKeys.text(url),
    queryFn: ({ signal }) => request<string>(url, { signal, headers: { Accept: "text/markdown, text/plain, application/json" } }),
    enabled,
    retry: false,
  })
}

export const generateFromTemplate = (id: string, body: GenerateRequest) =>
  request<GenerateResult>(`/api/templates/${encodeURIComponent(id)}/generate`, { json: body })

/**
 * `POST /api/templates/:id/generate`: a new document or, with `documentId`, its next version. The caller shows every
 * error itself (field problems on the form, STATUS_LOCKED as an alert, the rest as a toast), so the global toast is off.
 * On success every view a document appears in is refreshed: documents, dashboard, vault tree and search.
 */
export function useGenerateDocument(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: GenerateRequest) => generateFromTemplate(id, body),
    meta: { silentError: true },
    // Not awaited: the caller navigates straight away while the refetches run.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.documents.all })
      void client.invalidateQueries({ queryKey: ["dashboard"] })
      void client.invalidateQueries({ queryKey: treeKeys.all })
      void client.invalidateQueries({ queryKey: ["search"] })
    },
  })
}
