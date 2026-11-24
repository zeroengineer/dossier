import * as React from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { useUpload } from "@/api/upload"
import type { UploadResult } from "@/api/types"
import { toUploadFormData, tooLargeMessage, uploadErrorMessage, warningMessage } from "./upload-data"

/** Announce the result: success, a reused (deduplicated) file, and one warning toast per warning code. */
export function announceUpload(result: UploadResult, mode: "document" | "version") {
  const doc = result.document
  const label = doc.docNumber || doc.title || doc.id
  toast.success(mode === "version" ? `Version ${result.version.versionNo} of ${label} uploaded` : `Uploaded ${label}`)
  if (result.deduped) {
    toast.info("This file was already stored", { description: "Dossier reused the stored copy instead of saving the same bytes twice." })
  }
  for (const code of result.warnings) toast.warning(code, { description: warningMessage(code, doc.docNumber, doc.numberSeries) })
}

/**
 * The shared submit path of both upload modes: checks the file against the size limit, posts the multipart body,
 * announces the result and opens the document. A failure is returned for the form to show (and map onto fields).
 */
export function useUploadSubmit({ mode, maxBytes }: { mode: "document" | "version"; maxBytes: number | undefined }) {
  const upload = useUpload()
  const navigate = useNavigate()
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  async function submit(file: File | null, fields: Record<string, string | boolean>): Promise<unknown> {
    setSubmitError(null)
    if (!file) {
      setFileError("Choose a file to upload.")
      return null
    }
    if (maxBytes !== undefined && file.size > maxBytes) {
      setFileError(tooLargeMessage(maxBytes))
      return null
    }
    setFileError(null)
    try {
      const result = await upload.mutateAsync(toUploadFormData(file, fields))
      announceUpload(result, mode)
      await navigate(`/documents/${encodeURIComponent(result.document.id)}`)
      return null
    } catch (err) {
      setSubmitError(uploadErrorMessage(err, maxBytes))
      return err
    }
  }

  return { submit, pending: upload.isPending, fileError, setFileError, submitError }
}
