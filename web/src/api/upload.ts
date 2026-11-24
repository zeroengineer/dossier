import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import { treeKeys } from "./vault"
import type { UploadResult, UploadSeries } from "./types"

/** Query keys for the workspace's numbering series (prefix `series`). */
export const uploadSeriesKeys = {
  list: ["series", "list"] as const,
}

export const fetchUploadSeries = async (signal?: AbortSignal) =>
  (await request<{ series: UploadSeries[] }>("/api/series", { signal })).series

/** The workspace's numbering series (series.json), for the upload form's series Select. */
export function useUploadSeries() {
  return useQuery({ queryKey: uploadSeriesKeys.list, queryFn: ({ signal }) => fetchUploadSeries(signal), staleTime: 60_000 })
}

/** `POST /api/upload` with a ready multipart body (`file` plus metadata text fields). */
export const uploadFile = (body: FormData) => request<UploadResult>("/api/upload", { formData: body })

/**
 * Upload a file as a new document or a new version. On success the document lists, the dashboard and the vault tree
 * are marked stale. Errors are shown by the form itself (`silentError`), not toasted.
 */
export function useUpload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadFile,
    meta: { silentError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.documents.all })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      void queryClient.invalidateQueries({ queryKey: treeKeys.all })
    },
  })
}
