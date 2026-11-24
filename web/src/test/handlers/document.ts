import { http, HttpResponse } from "msw"
import { documentDetails, invoiceDoc, markdownOf } from "../fixtures-document"

const notFound = (id: string) => HttpResponse.json({ code: "DOCUMENT_NOT_FOUND", message: `No document ${id}`, details: { id } }, { status: 404 })

/**
 * Document page defaults: `GET /api/documents/:id` from the document fixtures (`DOC-000002` is above the demo user's
 * clearance, anything else unknown is a 404) and the Markdown rendition of `DOC-000001`.
 */
export const handlers = [
  http.get("*/api/documents/:id", ({ params }) => {
    const id = String(params["id"])
    if (id === "DOC-000002") {
      return HttpResponse.json(
        { code: "FORBIDDEN", message: 'User "demo" (Confidential clearance) may not read DOC-000002', details: { id } },
        { status: 403 },
      )
    }
    const doc = documentDetails.find((d) => d.id === id)
    return doc ? HttpResponse.json(doc) : notFound(id)
  }),
  http.get("*/documents/:id/renditions/md", ({ params, request }) => {
    const id = String(params["id"])
    if (id !== invoiceDoc.id) return notFound(id)
    const version = new URL(request.url).searchParams.get("version")
    return new HttpResponse(markdownOf(version ? Number(version) : invoiceDoc.currentVersion ?? 1), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    })
  }),
]
