import { useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { EntityMatchList } from "./types"

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
