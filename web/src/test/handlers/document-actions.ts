import { http, HttpResponse } from "msw"
import type { DocumentDetail } from "@/api/types"
import { documentDetails } from "../fixtures-document"

const find = (id: unknown) => documentDetails.find((d) => d.id === String(id))
const notFound = (id: unknown) =>
  HttpResponse.json({ code: "DOCUMENT_NOT_FOUND", message: `No document ${String(id)}`, details: { id } }, { status: 404 })

/**
 * Document action defaults (the fixtures are never changed): status and metadata answer with the patched document,
 * linking answers 201 with the relation, unlinking `{ removed: true }`. Search for the link picker is set per test.
 */
export const handlers = [
  http.post("*/api/documents/:id/status", async ({ params, request }) => {
    const doc = find(params["id"])
    if (!doc) return notFound(params["id"])
    const { status } = (await request.json()) as { status: DocumentDetail["status"] }
    return HttpResponse.json({ ...doc, status })
  }),
  http.post("*/api/documents/:id/metadata", async ({ params, request }) => {
    const doc = find(params["id"])
    if (!doc) return notFound(params["id"])
    const patch = (await request.json()) as Partial<DocumentDetail>
    return HttpResponse.json({ ...doc, ...patch, warnings: [] })
  }),
  http.post("*/api/documents/:id/links", async ({ params, request }) => {
    const doc = find(params["id"])
    if (!doc) return notFound(params["id"])
    const { toId, type, attrs } = (await request.json()) as { toId: string; type: string; attrs?: Record<string, unknown> }
    return HttpResponse.json({ id: 99, from: doc.id, to: toId, type, attrs: attrs ?? {} }, { status: 201 })
  }),
  http.delete("*/api/documents/:id/links", () => HttpResponse.json({ removed: true })),
]
