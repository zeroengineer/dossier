import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { server } from "@/test/server"
import { ApiError, errorMessage, request, withQuery } from "./api"

describe("request", () => {
  it("returns the parsed JSON body", async () => {
    await expect(request<{ user: { id: string } }>("/api/me")).resolves.toMatchObject({ user: { id: "demo" } })
  })

  it("turns an error body into an ApiError with status, code, message and details", async () => {
    server.use(
      http.get("*/api/documents/DOC-000404", () =>
        HttpResponse.json(
          { code: "DOCUMENT_NOT_FOUND", message: "No document DOC-000404", details: { id: "DOC-000404" } },
          { status: 404 },
        ),
      ),
    )
    const err = await request("/api/documents/DOC-000404").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(404)
    expect(apiErr.code).toBe("DOCUMENT_NOT_FOUND")
    expect(apiErr.message).toBe("No document DOC-000404")
    expect(apiErr.details).toEqual({ id: "DOC-000404" })
    expect(errorMessage(apiErr)).toBe("DOCUMENT_NOT_FOUND: No document DOC-000404")
  })

  it("exposes details.errors as strings", async () => {
    server.use(
      http.post("*/api/templates/invoice/preview", () =>
        HttpResponse.json(
          { code: "FIELDS_INVALID", message: "2 fields are invalid", details: { errors: ["billTo.name: required", "date: invalid"] } },
          { status: 400 },
        ),
      ),
    )
    const err = (await request("/api/templates/invoice/preview", { json: {} }).catch((e: unknown) => e)) as ApiError
    expect(err.errors).toEqual(["billTo.name: required", "date: invalid"])
  })

  it("maps a non-JSON failure to a generic ApiError", async () => {
    server.use(http.get("*/api/broken", () => new HttpResponse("Bad gateway", { status: 502, statusText: "Bad Gateway" })))
    const err = (await request("/api/broken").catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.code).toBe("HTTP_ERROR")
  })

  it("sends JSON bodies as application/json with POST and no client header", async () => {
    let seen: { method: string; type: string | null; client: string | null; body: unknown } | null = null
    server.use(
      http.post("*/api/echo", async ({ request: req }) => {
        seen = { method: req.method, type: req.headers.get("content-type"), client: req.headers.get("x-dossier-client"), body: await req.json() }
        return HttpResponse.json({ ok: true })
      }),
    )
    await request("/api/echo", { json: { a: 1 } })
    expect(seen).toEqual({ method: "POST", type: "application/json", client: null, body: { a: 1 } })
  })

  it("sends multipart bodies with X-Dossier-Client: web and the browser's boundary", async () => {
    let seen: { client: string | null; type: string | null; title: FormDataEntryValue | null } | null = null
    server.use(
      http.post("*/api/upload", async ({ request: req }) => {
        const form = await req.formData()
        seen = { client: req.headers.get("x-dossier-client"), type: req.headers.get("content-type"), title: form.get("title") }
        return HttpResponse.json({ id: "DOC-000001" }, { status: 201 })
      }),
    )
    const form = new FormData()
    form.set("title", "Acme Events invoice")
    form.set("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "invoice.pdf")
    await expect(request("/api/upload", { formData: form })).resolves.toEqual({ id: "DOC-000001" })
    expect(seen).not.toBeNull()
    expect(seen!.client).toBe("web")
    expect(seen!.type).toMatch(/^multipart\/form-data; boundary=/)
    expect(seen!.title).toBe("Acme Events invoice")
  })

  it("returns undefined for 204", async () => {
    server.use(http.delete("*/api/relations/1", () => new HttpResponse(null, { status: 204 })))
    await expect(request("/api/relations/1", { method: "DELETE" })).resolves.toBeUndefined()
  })
})

describe("withQuery", () => {
  it("drops empty values and repeats array keys", () => {
    expect(withQuery("/api/documents", { type: "invoice", status: ["Draft", "Sent"], partyId: undefined, q: "", limit: 20 }))
      .toBe("/api/documents?type=invoice&status=Draft&status=Sent&limit=20")
    expect(withQuery("/api/documents", {})).toBe("/api/documents")
  })
})
