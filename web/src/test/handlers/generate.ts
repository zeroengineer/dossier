import { http, HttpResponse } from "msw"
import { builtinTemplateDetails } from "../fixtures-generate"

/** A preview token as the server makes them (64 hex characters). */
export const PREVIEW_TOKEN = "ab".repeat(32)

/**
 * `GET /api/templates/:id`: the example workspace's built-in templates (any `brandId`); other ids 404.
 * `POST /api/templates/:id/preview`: a draft with PDF, HTML and Markdown for any input (tests override it per case).
 * `GET /previews/:token/preview.md`: the draft's Markdown.
 */
export const handlers = [
  http.get("*/api/templates/:id", ({ params }) => {
    const detail = builtinTemplateDetails[String(params["id"])]
    if (detail) return HttpResponse.json(detail)
    return HttpResponse.json(
      { code: "TEMPLATE_NOT_FOUND", message: `No template "${String(params["id"])}"`, details: {} },
      { status: 404 },
    )
  }),
  http.post("*/api/templates/:id/preview", () =>
    HttpResponse.json({
      ok: true,
      token: PREVIEW_TOKEN,
      renditions: ["pdf", "html", "md"].map((kind) => ({ kind, bytes: 1024, url: `/previews/${PREVIEW_TOKEN}/preview.${kind}` })),
      warnings: [],
    }),
  ),
  http.get("*/previews/:token/preview.md", () =>
    new HttpResponse("# Draft invoice\n\nDRAFT - NOT NUMBERED\n", { headers: { "Content-Type": "text/markdown; charset=utf-8" } }),
  ),
]
