import type { ApiErrorBody } from "@/api/types"

/** A failed API call: the HTTP status plus the server's `{ code, message, details }` body. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = "ApiError"
    this.status = status
    this.code = body.code
    this.details = body.details
  }

  /**
   * Field-level problems from `details`, for forms to map onto fields (`setError(path)`):
   * `details.errors[]` (`{ file, path, message }` from WORKSPACE_INVALID, `{ name, message }` from FIELDS_INVALID)
   * and `details.missing[]` (`{ name, label }` from FIELDS_MISSING, reported as "is required").
   */
  get fieldErrors(): FieldError[] {
    const out: FieldError[] = []
    const errors = this.details["errors"]
    if (Array.isArray(errors)) for (const e of errors) out.push(toFieldError(e))
    const missing = this.details["missing"]
    if (Array.isArray(missing)) {
      for (const m of missing) {
        const name = isRecord(m) && typeof m["name"] === "string" ? m["name"] : null
        out.push({ path: name, message: "is required", raw: m })
      }
    }
    return out
  }

  /** The field errors as one-line strings: `path: message` (JSON only for entries of unknown shape). */
  get errors(): string[] {
    return this.fieldErrors.map(formatFieldError)
  }
}

/** One field-level problem. `path` is the dotted field path or name (`billTo.name`, `items.0.amount`), or null. */
export interface FieldError {
  path: string | null
  message: string
  /** The entry as the server sent it (may carry `file`, `label`, …). */
  raw: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toFieldError(entry: unknown): FieldError {
  if (typeof entry === "string") return { path: null, message: entry, raw: entry }
  if (isRecord(entry)) {
    const path = typeof entry["path"] === "string" ? entry["path"] : typeof entry["name"] === "string" ? entry["name"] : null
    const message = typeof entry["message"] === "string" ? entry["message"] : null
    if (message !== null) return { path, message, raw: entry }
  }
  return { path: null, message: JSON.stringify(entry), raw: entry }
}

export function formatFieldError(e: FieldError): string {
  return e.path ? `${e.path}: ${e.message}` : e.message
}

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue | QueryValue[]>

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** Sent as `application/json` (passes the server's same-origin check). */
  json?: unknown
  /** Sent as multipart; adds `X-Dossier-Client: web` so the server accepts it without an Origin header. */
  formData?: FormData
  query?: Query
  signal?: AbortSignal
  headers?: Record<string, string>
}

/** Build `path?query`, dropping null, undefined and empty-string values; arrays repeat the key. */
export function withQuery(path: string, query?: Query): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (v === undefined || v === null || v === "") continue
      params.append(key, String(v))
    }
  }
  const qs = params.toString()
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "string"
    && typeof (value as { message?: unknown }).message === "string"
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Not JSON (a proxy error page, an empty body): fall through to a generic error.
  }
  if (isErrorBody(body)) {
    const details = typeof body.details === "object" && body.details !== null ? body.details : {}
    return new ApiError(res.status, { code: body.code, message: body.message, details })
  }
  return new ApiError(res.status, {
    code: res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR",
    message: res.statusText || `Request failed with status ${res.status}`,
    details: {},
  })
}

/**
 * Call the Dossier API and return the parsed JSON body (or `undefined` for 204). Non-2xx answers throw `ApiError`.
 * Network failures surface as `ApiError` with code `NETWORK_ERROR` and status 0.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = options.json !== undefined || options.formData ? "POST" : "GET", json, formData, query, signal } = options
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers }
  let body: BodyInit | undefined
  if (formData) {
    headers["X-Dossier-Client"] = "web"
    body = formData
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(json)
  }

  let res: Response
  try {
    res = await fetch(new URL(withQuery(path, query), window.location.origin), { method, headers, body, signal, credentials: "same-origin" })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "Could not reach the Dossier server", details: {} })
  }

  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  const type = res.headers.get("content-type") ?? ""
  if (!type.includes("json")) return (await res.text()) as T
  return (await res.json()) as T
}

/** Human-readable one-liner for an error: `CODE: message` for API errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.code}: ${err.message}`
  if (err instanceof Error) return err.message
  return String(err)
}
