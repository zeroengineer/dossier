import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { SearchResult } from "./types"

/** Query keys under `keys.search(q)` (prefix `search`), one per result limit. */
export const searchKeys = {
  query: (q: string, limit?: number) => [...keys.search(q), { limit: limit ?? null }] as const,
}

/** `GET /api/search?q=&limit=`. The server's default limit (20) applies when `limit` is undefined. */
export const fetchSearch = (q: string, limit?: number, signal?: AbortSignal) =>
  request<SearchResult>("/api/search", { query: { q, limit }, signal })

/**
 * Search results for `q` (trimmed by the caller). Disabled for an empty query. The previous results stay on screen
 * while the next query loads, so typing does not flash empty states.
 */
export function useSearch(q: string, options: { limit?: number } = {}) {
  const { limit } = options
  return useQuery({
    queryKey: searchKeys.query(q, limit),
    queryFn: ({ signal }) => fetchSearch(q, limit, signal),
    enabled: q !== "",
    placeholderData: keepPreviousData,
  })
}
