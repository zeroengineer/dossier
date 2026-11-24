import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api"
import { server } from "@/test/server"
import { previewTemplate } from "./generate"

describe("previewTemplate", () => {
  it("sends input and brandId as JSON and returns the draft", async () => {
    let sent: unknown
    server.use(
      http.post("*/api/templates/:id/preview", async ({ request, params }) => {
        sent = { id: params["id"], body: await request.json(), type: request.headers.get("content-type") }
        return HttpResponse.json({
          ok: true,
          token: "abc123",
          renditions: [{ kind: "pdf", bytes: 1200, url: "/previews/abc123/preview.pdf" }],
          warnings: [],
        })
      }),
    )
    const r = await previewTemplate("invoice", { input: { client: "Demo Retail LLP" }, brandId: "acme" })
    expect(sent).toEqual({
      id: "invoice",
      body: { input: { client: "Demo Retail LLP" }, brandId: "acme" },
      type: "application/json",
    })
    expect(r).toEqual({
      ok: true,
      token: "abc123",
      renditions: [{ kind: "pdf", bytes: 1200, url: "/previews/abc123/preview.pdf" }],
      warnings: [],
    })
  })

  it("returns the missing and invalid fields of a 400 instead of throwing", async () => {
    const problems = {
      ok: false,
      missing: [{ name: "client", label: "Client", type: "entity" }],
      errors: [{ name: "items.0.amount", message: '"abc" is not an amount' }],
    }
    server.use(http.post("*/api/templates/:id/preview", () => HttpResponse.json(problems, { status: 400 })))
    await expect(previewTemplate("invoice", { input: {} })).resolves.toEqual(problems)
  })

  it("throws ApiError with the code for other failures", async () => {
    server.use(
      http.post("*/api/templates/:id/preview", () =>
        HttpResponse.json({ code: "BRAND_NOT_FOUND", message: 'No brand "nope"', details: { brandId: "nope" } }, { status: 404 }),
      ),
    )
    const err = await previewTemplate("invoice", { input: {}, brandId: "nope" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: "BRAND_NOT_FOUND", details: { brandId: "nope" } })
  })

  it("throws a generic ApiError for a 400 that is not a preview body", async () => {
    server.use(http.post("*/api/templates/:id/preview", () => new HttpResponse("bad", { status: 400 })))
    await expect(previewTemplate("invoice", { input: {} })).rejects.toMatchObject({ status: 400, code: "HTTP_ERROR" })
  })
})
