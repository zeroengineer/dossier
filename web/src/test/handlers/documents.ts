import { http, HttpResponse } from "msw"
import type { DocumentList } from "@/api/types"
import { documentRows } from "../fixtures-documents"

/**
 * `GET /api/documents` over the example fixtures, applying the server's filters and paging (type, status, partyId,
 * from/to on docDate, limit/offset) so tables can be exercised end to end.
 */
export const handlers = [
  http.get("*/api/documents", ({ request }) => {
    const q = new URL(request.url).searchParams
    const type = q.get("type")
    const status = q.get("status")
    const partyId = q.get("partyId")
    const from = q.get("from")
    const to = q.get("to")
    const limit = Number(q.get("limit") ?? 50)
    const offset = Number(q.get("offset") ?? 0)
    const matches = documentRows.filter(
      (d) =>
        (!type || d.type === type)
        && (!status || d.status === status)
        && (!partyId || String(d.party?.id) === partyId)
        && (!from || (d.docDate !== null && d.docDate >= from))
        && (!to || (d.docDate !== null && d.docDate <= to)),
    )
    const body: DocumentList = { documents: matches.slice(offset, offset + limit), total: matches.length }
    return HttpResponse.json(body)
  }),
]
