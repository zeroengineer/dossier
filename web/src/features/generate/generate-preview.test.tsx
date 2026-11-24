import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentDetail, GenerateRequest, GenerateResult } from "@/api/types"
import { invoiceDoc } from "@/test/fixtures-document"
import { PREVIEW_TOKEN } from "@/test/handlers/generate"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** A label as rendered: the text, then an optional required marker. */
const label = (text: string) => new RegExp(`^${escape(text)}\\*?$`)

interface PreviewBody {
  input: Record<string, unknown>
  brandId?: string
}

/** Record every preview request body; `answer` decides the response (default: the stock draft). */
function capturePreviews(answer?: (body: PreviewBody) => Response | Promise<Response>) {
  const bodies: PreviewBody[] = []
  server.use(
    http.post("*/api/templates/:id/preview", async ({ request }) => {
      const body = (await request.json()) as PreviewBody
      bodies.push(body)
      if (answer) return answer(body)
      return HttpResponse.json({
        ok: true,
        token: PREVIEW_TOKEN,
        renditions: ["md", "html", "pdf"].map((kind) => ({ kind, bytes: 10, url: `/previews/${PREVIEW_TOKEN}/preview.${kind}` })),
        warnings: [],
      })
    }),
  )
  return bodies
}

function captureGenerate(answer: (body: GenerateRequest, n: number) => Response) {
  const bodies: GenerateRequest[] = []
  server.use(
    http.post("*/api/templates/:id/generate", async ({ request }) => {
      const body = (await request.json()) as GenerateRequest
      bodies.push(body)
      return answer(body, bodies.length)
    }),
  )
  return bodies
}

const generated = (overrides: Partial<GenerateResult> = {}): GenerateResult => ({
  documentId: "DOC-000010",
  number: "ACM-2026-0010",
  versionNo: 1,
  renditions: [{ kind: "pdf", sha256: "c".repeat(64), filename: "invoice.pdf", bytes: 2048 }],
  warnings: [],
  ...overrides,
})

/** An invoice generated from the built-in `invoice` template, now Sent, whose current version has an input. */
const sentInvoice: DocumentDetail = {
  ...invoiceDoc,
  id: "DOC-000010",
  docNumber: "ACM-2026-0010",
  status: "Sent",
  issuingBrandId: "acme-studio",
  template: { id: "invoice", version: 1 },
  versions: [
    {
      id: 21,
      versionNo: 1,
      isCurrent: true,
      note: null,
      input: { client: "Demo Retail LLP", bankAccount: "Example Bank 0001", items: [{ description: "Stage design", hsn: "998596", amount: "1,20,000" }] },
      createdBy: "demo",
      createdAt: "2026-04-01T10:00:00.000Z",
      renditions: [],
    },
  ],
}

beforeAll(async () => {
  await import("@/pages/generate")
})

beforeEach(() => {
  const client = { id: 4, kind: "client", name: "Demo Retail LLP", brand: null, aliases: [], matched: null }
  server.use(
    http.get("*/api/entities", ({ request }) =>
      HttpResponse.json({ entities: new URL(request.url).searchParams.get("kind") === "client" ? [client] : [] }),
    ),
  )
})

/** Fill what the form itself requires (Client, one item) so Generate reaches the server. */
async function fillRequired(user: ReturnType<typeof renderApp>["user"]) {
  await user.click(await screen.findByRole("combobox", { name: label("Client") }))
  await user.click(await screen.findByRole("option", { name: "Demo Retail LLP" }))
  await user.type(screen.getByRole("textbox", { name: "Items row 1 description" }), "Stage")
}

describe("Generate preview", () => {
  it("previews the form on load and shows the draft's files", async () => {
    const bodies = capturePreviews()
    const { user } = renderApp("/generate/invoice")
    const pdf = await screen.findByTitle("PDF preview of Invoice")
    expect(pdf.tagName).toBe("IFRAME")
    expect(pdf).toHaveAttribute("src", `/previews/${PREVIEW_TOKEN}/preview.pdf?v=${PREVIEW_TOKEN}`)
    expect(bodies[0]).toEqual({ input: expect.any(Object), brandId: "acme" })

    // Tabs in PDF, HTML, Markdown order whatever the server's order.
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabs).toEqual(["PDF", "HTML", "Markdown"])

    await user.click(screen.getByRole("tab", { name: "HTML" }))
    const html = screen.getByTitle("HTML preview of Invoice")
    expect(html).toHaveAttribute("sandbox", "")
    expect(html).toHaveAttribute("src", `/previews/${PREVIEW_TOKEN}/preview.html?v=${PREVIEW_TOKEN}`)

    await user.click(screen.getByRole("tab", { name: "Markdown" }))
    expect(await screen.findByLabelText("Markdown preview of Invoice")).toHaveTextContent("DRAFT - NOT NUMBERED")
  })

  it("asks again after typing stops, once, with the latest input", async () => {
    const bodies = capturePreviews()
    const { user } = renderApp("/generate/invoice")
    const bank = await screen.findByLabelText(label("Bank account"))
    await waitFor(() => expect(bodies).toHaveLength(1))
    await user.type(bank, "Example Bank")
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 3000 })
    expect(bodies[1]?.input["bankAccount"]).toBe("Example Bank")
    // Give a stray debounce time to fire: still one request for the whole word.
    await new Promise((r) => setTimeout(r, 800))
    expect(bodies).toHaveLength(2)
  })

  it("cancels a preview in flight when the input changes", async () => {
    const signals: AbortSignal[] = []
    server.use(
      http.post("*/api/templates/:id/preview", async ({ request }) => {
        signals.push(request.signal)
        if (signals.length === 1) await new Promise((r) => setTimeout(r, 5000))
        return HttpResponse.json({ ok: true, token: PREVIEW_TOKEN, renditions: [], warnings: [] })
      }),
    )
    const { user } = renderApp("/generate/invoice")
    const bank = await screen.findByLabelText(label("Bank account"))
    await waitFor(() => expect(signals).toHaveLength(1))
    await user.type(bank, "X")
    await waitFor(() => expect(signals).toHaveLength(2), { timeout: 3000 })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it("does not ask while a list or object field holds invalid JSON", async () => {
    const bodies = capturePreviews()
    const { user } = renderApp("/generate/receipt")
    const refs = await screen.findByLabelText(label("Documents paid"))
    await waitFor(() => expect(bodies).toHaveLength(1))
    await user.click(refs)
    await user.paste("[1,")
    expect(await screen.findByText("Fix this value to update the preview")).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 800))
    expect(bodies).toHaveLength(1)
  })

  it("lists missing fields, maps invalid row values onto the form row, and keeps fresh fields clean", async () => {
    capturePreviews(() =>
      HttpResponse.json(
        {
          ok: false,
          missing: [{ name: "client", label: "Client", type: "entity" }],
          // Row 0 of the input is the form's row 2: the blank first row is dropped.
          errors: [{ name: "items.0.amount", message: "not a money amount" }],
        },
        { status: 400 },
      ),
    )
    const { user } = renderApp("/generate/invoice")
    const items = await screen.findByRole("table", { name: label("Items") })
    await user.click(screen.getByRole("button", { name: "Add row" }))
    await user.type(within(items).getByRole("textbox", { name: "Items row 2 amount" }), "lots")

    const missing = await screen.findByText("Fill in to preview", {}, { timeout: 3000 })
    expect(missing.closest("[role=alert]")).toHaveTextContent("Client")
    expect(await screen.findByText("Items row 2 amount: not a money amount")).toBeInTheDocument()
    await waitFor(() => expect(within(items).getByRole("textbox", { name: "Items row 2 amount" })).toHaveAttribute("aria-invalid", "true"))
    expect(within(items).getByRole("textbox", { name: "Items row 1 amount" })).not.toHaveAttribute("aria-invalid")
    // Client was never touched: listed, not marked.
    expect(screen.getByRole("combobox", { name: label("Client") })).not.toHaveAttribute("aria-invalid", "true")
  })

  it("lists placeholders that print empty", async () => {
    capturePreviews(() =>
      HttpResponse.json({
        ok: true,
        token: PREVIEW_TOKEN,
        renditions: [{ kind: "pdf", bytes: 10, url: `/previews/${PREVIEW_TOKEN}/preview.pdf` }],
        warnings: [{ code: "PLACEHOLDER_EMPTY", name: "bankAccount", message: "Bank account prints empty" }],
      }),
    )
    renderApp("/generate/invoice")
    const title = await screen.findByText("Printed empty")
    expect(title.closest("[role=alert]")).toHaveTextContent("Bank account prints empty")
  })

  it("shows a render failure with a retry", async () => {
    capturePreviews(() =>
      HttpResponse.json({ code: "RENDER_FAILED", message: "Chrome crashed", details: {} }, { status: 500 }),
    )
    renderApp("/generate/invoice")
    expect(await screen.findByText("Could not render the preview")).toBeInTheDocument()
    expect(screen.getByText("RENDER_FAILED: Chrome crashed")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})

describe("Generate", () => {
  it("generates, toasts the number, refreshes document views and opens the document", async () => {
    capturePreviews()
    const bodies = captureGenerate(() => HttpResponse.json(generated(), { status: 201 }))
    const { user, router, queryClient } = renderApp("/generate/invoice")
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const bank = await screen.findByLabelText(label("Bank account"))
    await user.type(bank, "Example Bank")
    await fillRequired(user)
    await user.click(screen.getByRole("button", { name: "Generate" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000010"))
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({
      input: expect.objectContaining({
        client: "Demo Retail LLP",
        bankAccount: "Example Bank",
        items: [{ description: "Stage", hsn: "", amount: "" }],
      }),
      brandId: "acme",
    })
    expect(bodies[0]).not.toHaveProperty("documentId")
    expect(await screen.findByText("Generated ACM-2026-0010")).toBeInTheDocument()
    const prefixes = invalidate.mock.calls.map(([f]) => (f?.queryKey as unknown[] | undefined)?.[0])
    expect(prefixes).toEqual(expect.arrayContaining(["documents", "dashboard", "tree", "search"]))
  })

  it("puts FIELDS_MISSING and FIELDS_INVALID on the fields and stays", async () => {
    capturePreviews()
    captureGenerate(() =>
      HttpResponse.json(
        {
          code: "FIELDS_MISSING",
          message: "Missing fields: bankAccount",
          details: { missing: [{ name: "bankAccount", label: "Bank account" }], errors: [{ name: "items.0.amount", message: "not a money amount" }] },
        },
        { status: 400 },
      ),
    )
    const { user, router } = renderApp("/generate/invoice")
    const items = await screen.findByRole("table", { name: label("Items") })
    await fillRequired(user)
    await user.type(within(items).getByRole("textbox", { name: "Items row 1 amount" }), "lots")
    await user.click(screen.getByRole("button", { name: "Generate" }))

    expect(await screen.findByText("2 fields need attention")).toBeInTheDocument()
    expect(screen.getByText("Bank account: is required")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(label("Bank account"))).toHaveAttribute("aria-invalid", "true"))
    expect(within(items).getByRole("textbox", { name: "Items row 1 amount" })).toHaveAttribute("aria-invalid", "true")
    expect(router.state.location.pathname).toBe("/generate/invoice")
  })

  it("toasts other errors", async () => {
    capturePreviews()
    captureGenerate(() =>
      HttpResponse.json({ code: "NUMBER_CONTENDED", message: "Another process kept taking the next number", details: {} }, { status: 409 }),
    )
    const { user } = renderApp("/generate/invoice")
    await fillRequired(user)
    await user.click(screen.getByRole("button", { name: "Generate" }))
    expect(await screen.findByText("NUMBER_CONTENDED: Another process kept taking the next number")).toBeInTheDocument()
  })
})

describe("Regenerate", () => {
  beforeEach(() => {
    server.use(
      http.get("*/api/documents/:id", ({ params }) =>
        params["id"] === sentInvoice.id
          ? HttpResponse.json(sentInvoice)
          : HttpResponse.json({ code: "DOCUMENT_NOT_FOUND", message: "No document", details: {} }, { status: 404 }),
      ),
    )
  })

  it("prefills from the current version, shows the status and keeps the document's brand", async () => {
    const previews = capturePreviews()
    const templateBrands: (string | null)[] = []
    server.use(
      http.get("*/api/templates/invoice", ({ request }) => {
        templateBrands.push(new URL(request.url).searchParams.get("brandId"))
        return undefined
      }),
    )
    renderApp(`/generate/invoice?documentId=${sentInvoice.id}`)
    expect(await screen.findByLabelText(label("Bank account"))).toHaveValue("Example Bank 0001")
    expect(screen.getByRole("textbox", { name: "Items row 1 description" })).toHaveValue("Stage design")
    expect(screen.getByText(/^Regenerating ACM-2026-0010/)).toBeInTheDocument()
    expect(screen.getByText("Sent")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Brand" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "Brand" })).toHaveTextContent("Acme Studio LLP")
    expect(templateBrands).toEqual(["acme-studio"])
    await waitFor(() => expect(previews[0]?.brandId).toBe("acme-studio"))
    expect(screen.getByRole("link", { name: "Back to ACM-2026-0010" })).toHaveAttribute("href", "/documents/DOC-000010")
  })

  it("explains STATUS_LOCKED and resends with force and the note", async () => {
    capturePreviews()
    const bodies = captureGenerate((body) =>
      body.force
        ? HttpResponse.json(generated({ versionNo: 2 }), { status: 201 })
        : HttpResponse.json(
            {
              code: "STATUS_LOCKED",
              message: "DOC-000010 is Sent; regenerating would put it back to Draft. Generate a new document and supersede this one, or pass force: true",
              details: { documentId: "DOC-000010", status: "Sent" },
            },
            { status: 409 },
          ),
    )
    const { user, router } = renderApp(`/generate/invoice?documentId=${sentInvoice.id}`)
    await screen.findByLabelText(label("Bank account"))
    await user.type(screen.getByLabelText("Version note"), "Corrected the bank account")
    await user.click(screen.getByRole("button", { name: "Regenerate" }))

    const lockedTitle = await screen.findByText("ACM-2026-0010 is Sent")
    const alert = lockedTitle.closest("[role=alert]") as HTMLElement
    expect(within(alert).getByText(/Generate a new document and supersede this one/)).toBeInTheDocument()
    expect(bodies[0]).toEqual({ input: expect.any(Object), documentId: "DOC-000010", note: "Corrected the bank account" })
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()

    await user.click(within(alert).getByRole("checkbox", { name: "Regenerate anyway" }))
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000010"))
    expect(bodies[1]).toEqual({
      input: expect.objectContaining({ bankAccount: "Example Bank 0001" }),
      documentId: "DOC-000010",
      force: true,
      note: "Corrected the bank account",
    })
    expect(await screen.findByText("Regenerated ACM-2026-0010")).toBeInTheDocument()
  })

  it("can generate a new document from the same input instead", async () => {
    capturePreviews()
    const bodies = captureGenerate((_body, n) =>
      n === 1
        ? HttpResponse.json(
            { code: "STATUS_LOCKED", message: "DOC-000010 is Sent", details: { documentId: "DOC-000010", status: "Sent" } },
            { status: 409 },
          )
        : HttpResponse.json(generated({ documentId: "DOC-000011", number: "ACM-2026-0011" }), { status: 201 }),
    )
    const { user, router } = renderApp(`/generate/invoice?documentId=${sentInvoice.id}`)
    await screen.findByLabelText(label("Bank account"))
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    await user.click(await screen.findByRole("button", { name: "Generate a new document instead" }))

    await waitFor(() => expect(router.state.location.search).toBe(""))
    expect(screen.getByLabelText(label("Bank account"))).toHaveValue("Example Bank 0001")
    expect(screen.getByRole("combobox", { name: "Brand" })).toBeEnabled()
    expect(screen.getByRole("combobox", { name: "Brand" })).toHaveTextContent("Acme Studio LLP")
    await user.click(screen.getByRole("button", { name: "Generate" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000011"))
    expect(bodies[1]).toEqual({ input: expect.objectContaining({ bankAccount: "Example Bank 0001" }), brandId: "acme-studio" })
  })

  it("refuses a document generated from another template", async () => {
    server.use(http.get("*/api/documents/:id", () => HttpResponse.json({ ...sentInvoice, template: { id: "receipt", version: 1 } })))
    renderApp(`/generate/invoice?documentId=${sentInvoice.id}`)
    expect(await screen.findByText("Cannot regenerate with this template")).toBeInTheDocument()
  })
})
