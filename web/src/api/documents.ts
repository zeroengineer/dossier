import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
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

export const fetchPartyOptions = async (q: string, signal?: AbortSignal) =>
  (await request<{ entities: DocumentPartyOption[] }>("/api/entities", { query: { q, limit: PARTY_OPTION_LIMIT }, signal })).entities

/** Entities whose name or alias matches `q`, for the party filter. */
export function usePartyOptions(q: string, enabled = true) {
  return useQuery({
    queryKey: ["entities", "party-options", q] as const,
    queryFn: ({ signal }) => fetchPartyOptions(q, signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

/** The entity behind a `partyId` URL parameter, to label the active party filter. */
export function useParty(id: number | undefined) {
  return useQuery({
    queryKey: keys.entities.detail(String(id)),
    queryFn: ({ signal }) => request<DocumentPartyOption>(`/api/entities/${id}`, { signal }),
    enabled: id !== undefined,
    staleTime: 60_000,
  })
}
