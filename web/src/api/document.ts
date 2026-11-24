import { useQuery } from "@tanstack/react-query"
import { request, withQuery } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { DocumentDetail, RenditionKind } from "./types"

/** Query keys of one document's files, under `keys.documents.detail(id)` so invalidating the document drops them. */
export const documentKeys = {
  rendition: (id: string, kind: RenditionKind, versionNo: number | null) =>
    [...keys.documents.detail(id), "rendition", kind, versionNo] as const,
}

export const fetchDocument = (id: string, signal?: AbortSignal) =>
  request<DocumentDetail>(`/api/documents/${encodeURIComponent(id)}`, { signal })

/** Full metadata of one document (`GET /api/documents/:id`): versions, renditions, entities, relations. */
export function useDocument(id: string) {
  return useQuery({ queryKey: keys.documents.detail(id), queryFn: ({ signal }) => fetchDocument(id, signal), enabled: id !== "" })
}

/**
 * URL of a rendition's bytes (`/documents/:id/renditions/:kind`). `versionNo` null means the current version;
 * `download` asks for `Content-Disposition: attachment`.
 */
export function renditionUrl(id: string, kind: RenditionKind, { versionNo = null, download = false }: { versionNo?: number | null; download?: boolean } = {}) {
  return withQuery(`/documents/${encodeURIComponent(id)}/renditions/${kind}`, { version: versionNo, download: download ? 1 : null })
}

/** A text rendition (Markdown) fetched as a string. */
export const fetchRenditionText = (id: string, kind: RenditionKind, versionNo: number | null, signal?: AbortSignal) =>
  request<string>(renditionUrl(id, kind, { versionNo }), { signal, headers: { Accept: "text/markdown, text/plain, application/json" } })

export function useRenditionText(id: string, kind: RenditionKind, versionNo: number | null, enabled = true) {
  return useQuery({
    queryKey: documentKeys.rendition(id, kind, versionNo),
    queryFn: ({ signal }) => fetchRenditionText(id, kind, versionNo, signal),
    enabled,
    staleTime: 5 * 60_000,
  })
}
