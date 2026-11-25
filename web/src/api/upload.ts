import { useMutation, useQueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import { treeKeys } from "./vault"
import { useSeries } from "./settings"
import type { UploadResult } from "./types"

/** The workspace's numbering series (series.json), for the upload form's series Select: the canonical series query. */
export const useUploadSeries = () => useSeries()

/** `POST /api/upload` with a ready multipart body (`file` plus metadata text fields). */
export const uploadFile = (body: FormData) => request<UploadResult>("/api/upload", { formData: body })

/**
 * Upload a file as a new document or a new version. On success the document lists, the dashboard, the vault tree,
 * search results and the party's entity page are marked stale. Errors are shown by the form itself (`silentError`), not toasted.
 */
export function useUpload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadFile,
    meta: { silentError: true },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: keys.documents.all })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      void queryClient.invalidateQueries({ queryKey: treeKeys.all })
      void queryClient.invalidateQueries({ queryKey: ["search"] })
      // The party's page lists its documents.
      const party = result.document.party
      if (party) void queryClient.invalidateQueries({ queryKey: keys.entities.detail(String(party.id)) })
    },
  })
}
