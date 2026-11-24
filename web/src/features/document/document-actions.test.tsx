import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { createMemoryRouter, RouterProvider } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { treeKeys } from "@/api/vault"
import { keys } from "@/lib/keys"
import type { DocumentDetail, DocumentSummary } from "@/api/types"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createQueryClient } from "@/lib/query-client"
import { routes } from "@/router"
import { emptyDoc, invoiceDoc } from "@/test/fixtures-document"
import { server } from "@/test/server"

/** The app at `path` with the real query client, so failed mutations toast like in production. */
function renderPage(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  const client = createQueryClient()
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { user, router, client }
}

/** Serve `doc` from `GET /api/documents/:id` and let `update` change what later reads return. */
function serveDoc(initial: DocumentDetail) {
  let doc = initial
  server.use(http.get(`*/api/documents/${initial.id}`, () => HttpResponse.json(doc)))
  return { set: (next: Partial<DocumentDetail>) => (doc = { ...doc, ...next }) }
}

const summary = (d: DocumentDetail): DocumentSummary => ({
  id: d.id, type: d.type, title: d.title, status: d.status, sensitivity: d.sensitivity, party: d.party,
  docNumber: d.docNumber, numberSeries: d.numberSeries, numberConflict: d.numberConflict, docDate: d.docDate,
  dueDate: d.dueDate, amountMinor: d.amountMinor, currency: d.currency, currentVersion: d.currentVersion, updatedAt: d.updatedAt,
})

const proposal: DocumentSummary = {
  ...summary(invoiceDoc), id: "DOC-000004", type: "proposal", title: "Event services proposal", status: "Signed",
  docNumber: "ACM-P-2026-0002", amountMinor: null, currency: null,
}

const header = async () => {
  await screen.findByRole("heading", { level: 1, name: invoiceDoc.title })
  return within(screen.getByTestId("document-actions"))
}

describe("Document actions: status", () => {
  it("offers only the transitions meta allows and applies one after confirmation", async () => {
    const state = serveDoc(invoiceDoc)
    const bodies: unknown[] = []
    server.use(
      http.post("*/api/documents/DOC-000001/status", async ({ request }) => {
        const body = (await request.json()) as { status: DocumentDetail["status"] }
        bodies.push(body)
        state.set({ status: body.status })
        return HttpResponse.json({ ...invoiceDoc, status: body.status })
      }),
    )
    const { user } = renderPage("/documents/DOC-000001")
    await user.click((await header()).getByRole("button", { name: "Change status" }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Signed", "Paid", "Superseded"])
    await user.click(within(menu).getByRole("menuitem", { name: "Paid" }))

    const dialog = within(await screen.findByRole("alertdialog"))
    expect(dialog.getByText("Mark ACM-2026-0007 as Paid?")).toBeInTheDocument()
    expect(dialog.getByText(`${invoiceDoc.title} moves from Sent to Paid. This cannot be undone from the document page.`)).toBeInTheDocument()
    expect(bodies).toEqual([])
    const confirm = dialog.getByRole("button", { name: "Mark as Paid" })
    expect(confirm).toHaveAttribute("data-variant", "default")
    await user.click(confirm)

    await waitFor(() => expect(bodies).toEqual([{ status: "Paid" }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(await screen.findByText("Status changed to Paid")).toBeInTheDocument()
    const title = screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement
    await waitFor(() => expect(within(title).getByText("Paid")).toBeInTheDocument())
  })

  it("asks before superseding and sends nothing on cancel", async () => {
    const bodies: unknown[] = []
    server.use(
      http.post("*/api/documents/DOC-000001/status", async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ ...invoiceDoc, status: "Superseded" })
      }),
    )
    const { user } = renderPage("/documents/DOC-000001")
    await user.click((await header()).getByRole("button", { name: "Change status" }))
    await user.click(await screen.findByRole("menuitem", { name: "Superseded" }))

    let dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Mark ACM-2026-0007 as Superseded?")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Mark as Superseded" })).toHaveAttribute("data-variant", "destructive")
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(bodies).toEqual([])

    await user.click(screen.getByRole("button", { name: "Change status" }))
    await user.click(await screen.findByRole("menuitem", { name: "Superseded" }))
    dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Mark as Superseded" }))
    await waitFor(() => expect(bodies).toEqual([{ status: "Superseded" }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("toasts a refused transition (409) and keeps the confirm dialog open", async () => {
    server.use(
      http.post("*/api/documents/DOC-000001/status", () =>
        HttpResponse.json(
          { code: "INVALID_STATUS_TRANSITION", message: "Cannot change status from Paid to Signed (allowed: Superseded)", details: {} },
          { status: 409 },
        ),
      ),
    )
    const { user } = renderPage("/documents/DOC-000001")
    await user.click((await header()).getByRole("button", { name: "Change status" }))
    await user.click(await screen.findByRole("menuitem", { name: "Signed" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Mark as Signed" }))
    expect(await screen.findByText("INVALID_STATUS_TRANSITION: Cannot change status from Paid to Signed (allowed: Superseded)")).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("disables the menu for a final status", async () => {
    serveDoc({ ...invoiceDoc, status: "Superseded" })
    renderPage("/documents/DOC-000001")
    const actions = await header()
    await waitFor(() => expect(actions.getByRole("button", { name: "Change status" })).toBeDisabled())
  })
})

describe("Document actions: navigation and downloads", () => {
  it("links Regenerate and Upload new version, and lists the current files for download", async () => {
    const { user } = renderPage("/documents/DOC-000001")
    const actions = await header()
    expect(actions.getByRole("link", { name: "Regenerate" })).toHaveAttribute("href", "/generate/acme-invoice?documentId=DOC-000001")
    expect(actions.getByRole("link", { name: "Upload new version" })).toHaveAttribute("href", "/upload?documentId=DOC-000001")

    await user.click(actions.getByRole("button", { name: "Download" }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: /PDF/ })).toHaveAttribute("href", "/documents/DOC-000001/renditions/pdf?download=1")
    expect(within(menu).getByRole("menuitem", { name: /Markdown/ })).toHaveAttribute("href", "/documents/DOC-000001/renditions/md?download=1")
    expect(within(menu).queryByRole("menuitem", { name: /HTML/ })).not.toBeInTheDocument()
  })

  it("hides Regenerate for an uploaded document and disables Download without files", async () => {
    renderPage(`/documents/${emptyDoc.id}`)
    await screen.findByRole("heading", { level: 1, name: emptyDoc.title })
    const actions = within(screen.getByTestId("document-actions"))
    expect(actions.queryByRole("link", { name: "Regenerate" })).not.toBeInTheDocument()
    expect(actions.getByRole("button", { name: "Download" })).toBeDisabled()
    expect(actions.getByRole("link", { name: "Upload new version" })).toHaveAttribute("href", `/upload?documentId=${emptyDoc.id}`)
  })
})

describe("Document actions: metadata", () => {
  const openEdit = async (user: ReturnType<typeof userEvent.setup>) => {
    const details = (await screen.findByLabelText("Document details")).closest("[data-slot=card]") as HTMLElement
    await user.click(within(details).getByRole("button", { name: "Edit" }))
    return within(await screen.findByRole("dialog"))
  }

  it("sends only the changed fields, with a cleared date as null", async () => {
    const bodies: unknown[] = []
    server.use(
      http.post("*/api/documents/DOC-000001/metadata", async ({ request }) => {
        const body = (await request.json()) as Partial<DocumentDetail>
        bodies.push(body)
        return HttpResponse.json({ ...invoiceDoc, ...body, warnings: [] })
      }),
    )
    const { user } = renderPage("/documents/DOC-000001")
    const dialog = await openEdit(user)
    expect(dialog.getByLabelText("Title")).toHaveValue(invoiceDoc.title)
    expect(dialog.getByLabelText("Number")).toHaveValue("ACM-2026-0007")
    await user.clear(dialog.getByLabelText("Title"))
    await user.type(dialog.getByLabelText("Title"), "Event services invoice (final)")
    fireEvent.change(dialog.getByLabelText("Due / expiry date"), { target: { value: "" } })
    await user.click(dialog.getByRole("combobox", { name: "Sensitivity" }))
    await user.click(await screen.findByRole("option", { name: "Confidential" }))
    await user.click(dialog.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(bodies).toEqual([{ title: "Event services invoice (final)", dueDate: null, sensitivity: "Confidential" }]))
    expect(await screen.findByText("Details saved")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("requires a title and sends nothing", async () => {
    let calls = 0
    server.use(http.post("*/api/documents/DOC-000001/metadata", () => {
      calls += 1
      return HttpResponse.json({ ...invoiceDoc, warnings: [] })
    }))
    const { user } = renderPage("/documents/DOC-000001")
    const dialog = await openEdit(user)
    await user.clear(dialog.getByLabelText("Title"))
    await user.click(dialog.getByRole("button", { name: "Save" }))
    expect(await dialog.findByText("Title is required")).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it("warns about a number conflict the save caused", async () => {
    server.use(
      http.post("*/api/documents/DOC-000001/metadata", async ({ request }) => {
        const body = (await request.json()) as Partial<DocumentDetail>
        return HttpResponse.json({ ...invoiceDoc, ...body, numberConflict: true, warnings: ["NUMBER_CONFLICT"] })
      }),
    )
    const { user } = renderPage("/documents/DOC-000001")
    const dialog = await openEdit(user)
    await user.clear(dialog.getByLabelText("Number"))
    await user.type(dialog.getByLabelText("Number"), "ACM-2026-0003")
    await user.click(dialog.getByRole("button", { name: "Save" }))
    expect(await screen.findByText("Saved with a number conflict")).toBeInTheDocument()
    expect(screen.getByText("Another document of acme-invoice already has number ACM-2026-0003.")).toBeInTheDocument()
  })

  it("puts a validation error on its field and keeps the dialog open", async () => {
    server.use(
      http.post("*/api/documents/DOC-000001/metadata", () =>
        HttpResponse.json({ code: "INVALID_INPUT", message: "docNumber is already reserved", details: { docNumber: "X" } }, { status: 400 }),
      ),
    )
    const { user } = renderPage("/documents/DOC-000001")
    const dialog = await openEdit(user)
    await user.type(dialog.getByLabelText("Number"), "-B")
    await user.click(dialog.getByRole("button", { name: "Save" }))
    expect(await dialog.findByText("docNumber is already reserved")).toBeInTheDocument()
    expect(dialog.getByLabelText("Number")).toHaveAttribute("aria-invalid", "true")
  })

  it("toasts other errors", async () => {
    server.use(
      http.post("*/api/documents/DOC-000001/metadata", () =>
        HttpResponse.json({ code: "SERIES_UNKNOWN", message: "Unknown series", details: { series: "x" } }, { status: 400 }),
      ),
    )
    const { user } = renderPage("/documents/DOC-000001")
    const dialog = await openEdit(user)
    await user.type(dialog.getByLabelText("Number"), "-B")
    await user.click(dialog.getByRole("button", { name: "Save" }))
    expect(await screen.findByText("SERIES_UNKNOWN: Unknown series")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})

describe("Document actions: links", () => {
  it("links a document found through search, never offering itself", async () => {
    const queries: string[] = []
    const bodies: unknown[] = []
    server.use(
      http.get("*/api/search", ({ request }) => {
        const url = new URL(request.url)
        queries.push(url.searchParams.get("q") ?? "")
        return HttpResponse.json({
          hits: [
            { document: summary(invoiceDoc), score: 1, match: "metadata", snippet: null },
            { document: proposal, score: 1, match: "metadata", snippet: null },
          ],
          related: [],
          entities: [],
        })
      }),
      http.post("*/api/documents/DOC-000001/links", async ({ request }) => {
        const body = (await request.json()) as { toId: string; type: string }
        bodies.push(body)
        return HttpResponse.json({ id: 9, from: "DOC-000001", to: body.toId, type: body.type, attrs: {} }, { status: 201 })
      }),
    )
    const { user, client } = renderPage("/documents/DOC-000001")
    const invalidate = vi.spyOn(client, "invalidateQueries")
    await screen.findByRole("list", { name: "Relations" })
    await user.click(screen.getByRole("button", { name: "Add link" }))
    const dialog = within(await screen.findByRole("dialog"))

    await user.click(dialog.getByRole("combobox", { name: "Relation" }))
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(options).toEqual(["based on", "pays", "settles", "adjusts", "follows", "supersedes", "rendition of"])
    await user.click(screen.getByRole("option", { name: "follows" }))

    await user.click(dialog.getByRole("combobox", { name: "Document" }))
    await user.type(await screen.findByRole("combobox", { name: "Search documents" }), "event services")
    const item = await screen.findByRole("option", { name: /Event services proposal/ })
    expect(screen.queryByRole("option", { name: /Event services invoice/ })).not.toBeInTheDocument()
    expect(queries.at(-1)).toBe("event services")
    await user.click(item)
    expect(dialog.getByRole("combobox", { name: "Document" })).toHaveTextContent("Event services proposal · ACM-P-2026-0002")

    await user.click(dialog.getByRole("button", { name: "Add link" }))
    await waitFor(() => expect(bodies).toEqual([{ toId: "DOC-000004", type: "follows" }]))
    expect(await screen.findByText("Linked: follows ACM-P-2026-0002")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    const invalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(invalidated).toEqual(expect.arrayContaining([keys.documents.all, ["search"], ["dashboard"], treeKeys.all]))
  })

  it("says so when the document search fails", async () => {
    server.use(http.get("*/api/search", () =>
      HttpResponse.json({ code: "INVALID_INPUT", message: "Bad query", details: {} }, { status: 400 })))
    const { user } = renderPage("/documents/DOC-000001")
    await screen.findByRole("list", { name: "Relations" })
    await user.click(screen.getByRole("button", { name: "Add link" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.click(dialog.getByRole("combobox", { name: "Document" }))
    await user.type(await screen.findByRole("combobox", { name: "Search documents" }), "acme")
    expect(await screen.findByText("Could not search documents.")).toBeInTheDocument()
    expect(screen.queryByText("No documents found.")).not.toBeInTheDocument()
  })

  it("needs a relation and a document before it sends anything", async () => {
    let calls = 0
    server.use(http.post("*/api/documents/DOC-000001/links", () => {
      calls += 1
      return HttpResponse.json({}, { status: 201 })
    }))
    const { user } = renderPage("/documents/DOC-000001")
    await screen.findByRole("list", { name: "Relations" })
    await user.click(screen.getByRole("button", { name: "Add link" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.click(dialog.getByRole("button", { name: "Add link" }))
    expect(dialog.getByText("Pick a relation type")).toBeInTheDocument()
    expect(dialog.getByText("Pick a document to link")).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it("removes an outgoing link after confirmation", async () => {
    const urls: string[] = []
    server.use(http.delete("*/api/documents/:id/links", ({ request }) => {
      urls.push(new URL(request.url).pathname + new URL(request.url).search)
      return HttpResponse.json({ removed: true })
    }))
    const { user } = renderPage("/documents/DOC-000001")
    const relations = within(await screen.findByRole("list", { name: "Relations" }))
    await user.click(relations.getByRole("button", { name: "Remove link based on ACM-P-2026-0002" }))
    const dialog = within(await screen.findByRole("alertdialog"))
    expect(dialog.getByText("Remove this link?")).toBeInTheDocument()
    await user.click(dialog.getByRole("button", { name: "Remove link" }))
    await waitFor(() => expect(urls).toEqual(["/api/documents/DOC-000001/links?toId=DOC-000004&type=based_on"]))
    expect(await screen.findByText("Link removed")).toBeInTheDocument()
  })

  it("removes an incoming link from the other document's side", async () => {
    const urls: string[] = []
    server.use(http.delete("*/api/documents/:id/links", ({ request }) => {
      urls.push(new URL(request.url).pathname + new URL(request.url).search)
      return HttpResponse.json({ removed: true })
    }))
    const { user } = renderPage("/documents/DOC-000001")
    const relations = within(await screen.findByRole("list", { name: "Relations" }))
    await user.click(relations.getByRole("button", { name: "Remove link pays (incoming) Payment receipt" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove link" }))
    await waitFor(() => expect(urls).toEqual(["/api/documents/DOC-000005/links?toId=DOC-000001&type=pays"]))
  })

  it("keeps the confirm dialog open and toasts when removing fails", async () => {
    server.use(http.delete("*/api/documents/:id/links", () =>
      HttpResponse.json({ code: "FORBIDDEN", message: "No access to DOC-000004", details: {} }, { status: 403 })))
    const { user } = renderPage("/documents/DOC-000001")
    const relations = within(await screen.findByRole("list", { name: "Relations" }))
    await user.click(relations.getByRole("button", { name: "Remove link based on ACM-P-2026-0002" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove link" }))
    expect(await screen.findByText("FORBIDDEN: No access to DOC-000004")).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })
})
