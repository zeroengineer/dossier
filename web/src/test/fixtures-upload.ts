import type { SeriesEntry, UploadResult } from "@/api/types"
import { invoiceDoc, uploadedDoc } from "./fixtures-document"

// Example workspace data only (Acme Events, ACM- numbers).

export const uploadSeries: SeriesEntry[] = [
  { id: "invoice-main", pattern: "ACM-{YYYY}-{####}", scope: "brand+year", start: 1 },
  { id: "debit-note", pattern: "ACM-DN-{YYYY}-{####}", scope: "brand+year", counter: "invoice-main" },
]

/** `POST /api/upload` answer for a new document (the uploaded Word file `DOC-000006`). */
export const newDocumentResult: UploadResult = {
  document: uploadedDoc,
  version: uploadedDoc.versions[0]!,
  deduped: false,
  warnings: [],
}

/** `POST /api/upload` answer for a new version of `DOC-000001`. */
export const newVersionResult: UploadResult = {
  document: invoiceDoc,
  version: { ...invoiceDoc.versions[1]!, id: 13, versionNo: 3, note: "Countersigned copy" },
  deduped: false,
  warnings: [],
}
