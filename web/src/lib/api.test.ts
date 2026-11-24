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

  it("formats FIELDS_INVALID entries ({ name, message }) and keeps them as field errors", async () => {
    server.use(
      http.post("*/api/templates/invoice/preview", () =>
        HttpResponse.json(
          {
            code: "FIELDS_INVALID",
            message: "Invalid fields: date (expected YYYY-MM-DD); items.0.amount (expected an amount)",
            details: {
              errors: [
                { name: "date", message: "expected YYYY-MM-DD" },
                { name: "items.0.amount", message: "expected an amount" },
              ],
            },
          },
          { status: 400 },
        ),
      ),
    )
    const err = (await request("/api/templates/invoice/preview", { json: {} }).catch((e: unknown) => e)) as ApiError
    expect(err.errors).toEqual(["date: expected YYYY-MM-DD", "items.0.amount: expected an amount"])
    expect(err.fieldErrors.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: "date", message: "expected YYYY-MM-DD" },
      { path: "items.0.amount", message: "expected an amount" },
    ])
  })

  it("formats FIELDS_MISSING entries ({ name, label, type }) as required fields", async () => {
    server.use(
      http.post("*/api/templates/invoice/generate", () =>
        HttpResponse.json(
          {
            code: "FIELDS_MISSING",
            message: "Missing fields: billTo",
            details: { missing: [{ name: "billTo", label: "Bill to", type: "entity" }], errors: [] },
          },
          { status: 400 },
        ),
      ),
    )
    const err = (await request("/api/templates/invoice/generate", { json: {} }).catch((e: unknown) => e)) as ApiError
    expect(err.errors).toEqual(["billTo: is required"])
    expect(err.fieldErrors[0]).toMatchObject({ path: "billTo", message: "is required", raw: { label: "Bill to" } })
  })

  it("formats WORKSPACE_INVALID entries ({ file, path, message }) by path", async () => {
    server.use(
      http.put("*/api/brands/acme", () =>
        HttpResponse.json(
          {
            code: "WORKSPACE_INVALID",
            message: "brands/acme/brand.json: palette.primary: must be a hex colour like #1a1a1a",
            details: {
              file: "brands/acme/brand.json",
              errors: [{ file: "brands/acme/brand.json", path: "palette.primary", message: "must be a hex colour like #1a1a1a" }],
            },
          },
          { status: 400 },
        ),
      ),
    )
    const err = (await request("/api/brands/acme", { method: "PUT", json: {} }).catch((e: unknown) => e)) as ApiError
    expect(err.errors).toEqual(["palette.primary: must be a hex colour like #1a1a1a"])
    expect(err.fieldErrors[0]).toMatchObject({ path: "palette.primary", raw: { file: "brands/acme/brand.json" } })
  })

  it("falls back to the message alone, or JSON for entries of unknown shape", async () => {
    server.use(
      http.get("*/api/odd", () =>
        HttpResponse.json(
          { code: "INVALID_INPUT", message: "Odd", details: { errors: ["plain text", { message: "no path" }, { weird: 1 }] } },
          { status: 400 },
        ),
      ),
    )
    const err = (await request("/api/odd").catch((e: unknown) => e)) as ApiError
    expect(err.errors).toEqual(["plain text", "no path", '{"weird":1}'])
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
