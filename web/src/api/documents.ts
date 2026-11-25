import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import { fetchEntities } from "./entities"
import type { DocumentList, DocumentListParams, DocumentPartyOption } from "./types"

export const fetchDocuments = (params: DocumentListParams, signal?: AbortSignal) =>
  request<DocumentList>("/api/documents", { query: { ...params }, signal })

/** One page of documents for the given server-side filters; keeps the previous page on screen while the next loads. */
export function useDocuments(params: DocumentListParams) {
  return useQuery({
    queryKey: keys.documents.list({ ...params }),
    queryFn: ({ signal }) => fetchDocuments(params, signal),
    placeholderData: keepPreviousData,
  })
}

const PARTY_OPTION_LIMIT = 20

/** Entities whose name or alias matches `q`, for the party filter and picker. */
export function usePartyOptions(q: string, enabled = true) {
  return useQuery({
    queryKey: ["entities", "party-options", q] as const,
    queryFn: async ({ signal }): Promise<DocumentPartyOption[]> => (await fetchEntities({ q, limit: PARTY_OPTION_LIMIT }, signal)).entities,
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
