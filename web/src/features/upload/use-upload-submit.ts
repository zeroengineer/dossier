import * as React from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { useUpload } from "@/api/upload"
import type { UploadResult } from "@/api/types"
import { toUploadFormData, tooLargeMessage, uploadErrorMessage, warningMessage, warningTitle } from "./upload-data"

/** Announce the result: success, a reused (deduplicated) file, and one warning toast per warning code. */
export function announceUpload(result: UploadResult, mode: "document" | "version") {
  const doc = result.document
  const label = doc.docNumber || doc.title || doc.id
  toast.success(mode === "version" ? `Version ${result.version.versionNo} of ${label} uploaded` : `Uploaded ${label}`)
  if (result.deduped) {
    toast.info("This file was already stored", { description: "Dossier reused the stored copy instead of saving the same bytes twice." })
  }
  for (const code of result.warnings) {
    toast.warning(warningTitle(code), { description: `${warningMessage(code, doc.docNumber, doc.numberSeries)} (${code})` })
  }
}

/**
 * The shared file state and submit path of both upload modes: holds the chosen file (size-checked as soon as it is
 * chosen), posts the multipart body,
 * announces the result and opens the document. A failure is returned for the form to show (and map onto fields).
 */
export function useUploadSubmit({ mode, maxBytes }: { mode: "document" | "version"; maxBytes: number | undefined }) {
  const upload = useUpload()
  const navigate = useNavigate()
  const [file, setFile] = React.useState<File | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  /** Take a chosen or dropped file (or null to clear it), checking the size limit right away. */
  function chooseFile(next: File | null) {
    setFile(next)
    setFileError(next && maxBytes !== undefined && next.size > maxBytes ? tooLargeMessage(maxBytes) : null)
  }

  async function submit(fields: Record<string, string | boolean>): Promise<unknown> {
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

  return { file, chooseFile, submit, pending: upload.isPending, fileError, submitError }
}
