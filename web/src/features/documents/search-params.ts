import type { DocumentListParams, Status } from "@/api/types"
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/components/data-table"

/** The documents table's state as it lives in the URL (`/documents?type=Invoice&status=Sent&page=2`). */
export interface DocumentsSearch {
  type?: string
  status?: Status
  partyId?: number
  from?: string
  to?: string
  /** 1-based. */
  page: number
  size: number
}

/** URL parameters that filter (everything but paging). */
export const FILTER_PARAMS = ["type", "status", "partyId", "from", "to"] as const

const DATE = /^\d{4}-\d{2}-\d{2}$/
const POSITIVE = /^[1-9]\d*$/

/**
 * Read the table state from the URL. Malformed values are dropped (the server stays the judge of what a valid
 * filter is: an unknown type or status just matches nothing or answers an error shown in the table).
 */
export function parseDocumentsSearch(params: URLSearchParams): DocumentsSearch {
  const text = (key: string) => {
    const v = params.get(key)?.trim()
    return v ? v : undefined
  }
  const partyId = text("partyId")
  const from = text("from")
  const to = text("to")
  const page = text("page")
  const size = text("size")
  return {
    type: text("type"),
    status: text("status") as Status | undefined,
    partyId: partyId && POSITIVE.test(partyId) ? Number(partyId) : undefined,
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    page: page && POSITIVE.test(page) ? Number(page) : 1,
    size: size && PAGE_SIZE_OPTIONS.includes(Number(size)) ? Number(size) : DEFAULT_PAGE_SIZE,
  }
}

/** Write the table state back as URL parameters, leaving defaults (page 1, default size) out. */
export function toSearchParams(search: DocumentsSearch): URLSearchParams {
  const out = new URLSearchParams()
  for (const key of FILTER_PARAMS) {
    const v = search[key]
    if (v !== undefined && v !== "") out.set(key, String(v))
  }
  if (search.page > 1) out.set("page", String(search.page))
  if (search.size !== DEFAULT_PAGE_SIZE) out.set("size", String(search.size))
  return out
}

/** The `GET /api/documents` query for the table state. */
export function toListParams(search: DocumentsSearch): DocumentListParams {
  return {
    type: search.type,
    status: search.status,
    partyId: search.partyId,
    from: search.from,
    to: search.to,
    limit: search.size,
    offset: (search.page - 1) * search.size,
  }
}

export const hasFilters = (search: DocumentsSearch) => FILTER_PARAMS.some((key) => search[key] !== undefined)
