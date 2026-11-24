import { http, HttpResponse } from "msw"
import { builtinTemplateDetails } from "../fixtures-generate"

/** `GET /api/templates/:id`: the example workspace's built-in templates (any `brandId`); other ids 404. */
export const handlers = [
  http.get("*/api/templates/:id", ({ params }) => {
    const detail = builtinTemplateDetails[String(params["id"])]
    if (detail) return HttpResponse.json(detail)
    return HttpResponse.json(
      { code: "TEMPLATE_NOT_FOUND", message: `No template "${String(params["id"])}"`, details: {} },
      { status: 404 },
    )
  }),
]
