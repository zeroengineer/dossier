import { http, HttpResponse } from "msw"
import { newDocumentResult, newVersionResult } from "../fixtures-upload"

/**
 * `POST /api/upload`: a new version when the body carries `documentId`, else a new document. A body without a `file`
 * part is refused like the server does. (`GET /api/series` and `/api/entities` belong to other areas; upload tests add
 * them with `server.use`.)
 */
export const handlers = [
  http.post("*/api/upload", async ({ request }) => {
    const body = await request.formData()
    if (!body.get("file")) {
      return HttpResponse.json({ code: "INVALID_INPUT", message: 'A multipart "file" part is required', details: {} }, { status: 400 })
    }
    return HttpResponse.json(body.get("documentId") ? newVersionResult : newDocumentResult, { status: 201 })
  }),
]
