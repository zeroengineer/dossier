import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import { treeKeys } from "./vault"
import type {
  DocumentDetail,
  DocumentLink,
  DocumentLinkInput,
  DocumentLinkSearch,
  DocumentMetadataPatch,
  DocumentMetadataResult,
  DocumentUnlinkResult,
  Status,
} from "./types"

const docPath = (id: string) => `/api/documents/${encodeURIComponent(id)}`

/** Query key of the link picker's document search (under `search`, so search invalidation drops it too). */
export const linkSearchKey = (q: string) => [...keys.search(q), "link-picker"] as const

/**
 * Drop everything a document change can show up in: every document query (lists, both ends of a link, renditions),
 * search results, the dashboard and the vault tree (folders list documents with their status and file names).
 */
function invalidateDocuments(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.documents.all }),
    client.invalidateQueries({ queryKey: ["search"] }),
    client.invalidateQueries({ queryKey: ["dashboard"] }),
    client.invalidateQueries({ queryKey: treeKeys.all }),
  ])
}

export const updateStatus = (id: string, status: Status) =>
  request<DocumentDetail>(`${docPath(id)}/status`, { json: { status } })

export const updateMetadata = (id: string, patch: DocumentMetadataPatch) =>
  request<DocumentMetadataResult>(`${docPath(id)}/metadata`, { json: patch })

export const linkDocument = (id: string, input: DocumentLinkInput) =>
  request<DocumentLink>(`${docPath(id)}/links`, { json: input })

/** Remove the relation `fromId --type--> toId` (`toId` may be `template:<id>@<version>`). */
export const unlinkDocument = (fromId: string, toId: string, type: string) =>
  request<DocumentUnlinkResult>(`${docPath(fromId)}/links`, { method: "DELETE", query: { toId, type } })

/** `POST /api/documents/:id/status`. Errors (INVALID_STATUS_TRANSITION, …) are toasted by the query client. */
export function useUpdateStatus(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (status: Status) => updateStatus(id, status),
    onSuccess: (doc) => {
      client.setQueryData(keys.documents.detail(id), doc)
      return invalidateDocuments(client)
    },
  })
}

/**
 * `POST /api/documents/:id/metadata`. The result carries `warnings` (e.g. NUMBER_CONFLICT) for the caller to show.
 * Errors are not toasted here: the edit form maps field errors itself and toasts the rest.
 */
export function useUpdateMetadata(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: DocumentMetadataPatch) => updateMetadata(id, patch),
    meta: { silentError: true },
    onSuccess: ({ warnings: _warnings, ...doc }) => {
      client.setQueryData<DocumentDetail>(keys.documents.detail(id), doc)
      return invalidateDocuments(client)
    },
  })
}

/** `POST /api/documents/:id/links` from this document. */
export function useLinkDocument(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentLinkInput) => linkDocument(id, input),
    onSuccess: () => invalidateDocuments(client),
  })
}

/** `DELETE /api/documents/:fromId/links?toId&type`; `fromId` is whichever end the relation starts at. */
export function useUnlinkDocument() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ fromId, toId, type }: { fromId: string; toId: string; type: string }) => unlinkDocument(fromId, toId, type),
    onSuccess: () => invalidateDocuments(client),
  })
}

export const searchDocumentsForLink = (q: string, signal?: AbortSignal) =>
  request<DocumentLinkSearch>("/api/search", { query: { q, limit: 8, expand: 0 }, signal })

/** Documents matching `q` (number, title, party, text) for the link picker; idle while `q` is blank. */
export function useLinkSearch(q: string) {
  const text = q.trim()
  return useQuery({
    queryKey: linkSearchKey(text),
    queryFn: ({ signal }) => searchDocumentsForLink(text, signal),
    enabled: text !== "",
    staleTime: 30_000,
  })
}
