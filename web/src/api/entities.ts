import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { DocumentList, EntityDetail, EntityInput, EntityList, EntityRelation } from "./types"
import { treeKeys } from "./vault"

/** Largest `limit` `GET /api/entities` accepts; the entities page loads the whole list (client-side table). */
export const ENTITY_LIST_LIMIT = 500
/** How many of an entity's documents its page lists. */
export const ENTITY_DOCUMENTS_LIMIT = 100

export interface EntityListParams {
  kind?: string
  q?: string
  limit?: number
}

/** Keys under the `entities` prefix (and `documents` for an entity's documents), so prefix invalidation reaches them. */
export const entityKeys = {
  list: (params: EntityListParams) => keys.entities.list({ ...params }),
  detail: (id: string) => keys.entities.detail(id),
  documents: (id: number) => keys.documents.list({ entityId: id, limit: ENTITY_DOCUMENTS_LIMIT }),
}

/**
 * `GET /api/entities`: the one fetcher for entity lists (the entities page, the party pickers and the generate form's
 * entity fields). `kind` narrows to one kind, `q` matches names and aliases, `limit` is 1..ENTITY_LIST_LIMIT.
 */
export const fetchEntities = (params: EntityListParams, signal?: AbortSignal) =>
  request<EntityList>("/api/entities", { query: { kind: params.kind, q: params.q, limit: params.limit }, signal })

/** Entities of one kind (or every kind), optionally matching `q` (name or alias, normalised by the server). */
export function useEntities(params: EntityListParams, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: entityKeys.list(params),
    queryFn: ({ signal }) => fetchEntities(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export const fetchEntity = (id: string, signal?: AbortSignal) =>
  request<EntityDetail>(`/api/entities/${encodeURIComponent(id)}`, { signal })

/**
 * One entity with aliases, attributes, relations in both directions and its document count. The detail key always
 * holds an `EntityDetail` (`useParty` reads the same key and fetcher).
 */
export function useEntity(id: string) {
  return useQuery({ queryKey: entityKeys.detail(id), queryFn: ({ signal }) => fetchEntity(id, signal), enabled: id !== "" })
}

/** The entity behind a `partyId`, to label the active party filter or picker (the `useEntity` query, cached longer). */
export function useParty(id: number | undefined) {
  return useQuery({
    queryKey: entityKeys.detail(String(id)),
    queryFn: ({ signal }) => fetchEntity(String(id), signal),
    enabled: id !== undefined,
    staleTime: 60_000,
  })
}

/**
 * The first documents referencing the entity in any role that the user may see (`GET /api/documents?entityId=`),
 * with `total`: every such document the user may see.
 */
export function useEntityDocuments(id: number | undefined) {
  return useQuery({
    queryKey: entityKeys.documents(id ?? 0),
    queryFn: ({ signal }) =>
      request<DocumentList>("/api/documents", { query: { entityId: id, limit: ENTITY_DOCUMENTS_LIMIT }, signal }),
    enabled: id !== undefined,
  })
}

/**
 * Create (no `id`) or update an entity. Errors are shown in the form, not toasted. A rename or a new alias changes the
 * party names documents show, search results (entity hits and the documents indexed with the party's names) and the
 * vault tree's folders named after the party, so document, search and tree queries are refreshed too.
 */
export function useSaveEntity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EntityInput) => request<EntityDetail>("/api/entities", { json: input }),
    meta: { silentError: true },
    onSuccess: async (entity) => {
      queryClient.setQueryData(entityKeys.detail(String(entity.id)), entity)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.entities.all }),
        queryClient.invalidateQueries({ queryKey: keys.documents.all }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
        queryClient.invalidateQueries({ queryKey: treeKeys.all }),
      ])
    },
  })
}

/** Relate this entity to another: `from` --role--> `to` (an entity id). Errors are shown in the dialog. */
export function useRelateEntity(fromId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ to, role }: { to: number; role: string }) =>
      request<EntityRelation>(`/api/entities/${fromId}/relations`, { json: { to, role } }),
    meta: { silentError: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.entities.all }),
  })
}
