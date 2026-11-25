import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { acmeEvents, alexExample } from "@/test/fixtures-documents"
import { handlers as documentHandlers } from "@/test/handlers/documents"
import DocumentsPage from "@/pages/documents"
import { renderRoute } from "@/test/render"
import { server } from "@/test/server"

/** Records every `GET /api/documents` query string, then answers with the default fixture handler. */
function recordListRequests() {
  const seen: URLSearchParams[] = []
  server.use(
    http.get("*/api/documents", ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return undefined
    }),
    ...documentHandlers,
  )
  return seen
}

/** Party lookups (kept out of the default handlers so the entities feature owns `/api/entities`). */
function partyHandlers() {
  server.use(
    http.get("*/api/entities", ({ request }) => {
      const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase()
      return HttpResponse.json({ entities: [acmeEvents, alexExample].filter((e) => e.name.toLowerCase().includes(q)) })
    }),
    http.get("*/api/entities/:id", ({ params }) => {
      const e = [acmeEvents, alexExample].find((x) => String(x.id) === params["id"])
      return e ? HttpResponse.json(e) : HttpResponse.json({ code: "ENTITY_NOT_FOUND", message: "No such entity", details: {} }, { status: 404 })
    }),
  )
}

const bodyRows = () => {
  const table = screen.getByRole("table")
  return within(table).getAllByRole("row").slice(1)
}
const findCell = (name: string) => screen.findByRole("cell", { name })
const search = (router: { state: { location: { search: string } } }) => new URLSearchParams(router.state.location.search)

describe("Documents table", () => {
  it("shows number (with conflict badge), title, type, party, status, date and amount", async () => {
    const seen = recordListRequests()
    renderRoute(<DocumentsPage />, "/documents", { route: "/documents" })
    expect(await findCell("Stage invoice")).toBeInTheDocument()
    for (const name of ["Number", "Title", "Type", "Party", "Status", "Date", "Amount"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument()
    }
    const [first, second, third] = bodyRows()
    expect(within(first!).getByText("ACM-2026-001")).toBeInTheDocument()
    expect(within(first!).getByText("Acme Events")).toBeInTheDocument()
    expect(within(first!).getByText("Sent")).toBeInTheDocument()
    expect(within(first!).getByText("₹1,23,456.00")).toBeInTheDocument()
    expect(within(first!).getByText("1 Apr 2026")).toBeInTheDocument()
    expect(within(first!).queryByText("Conflict")).not.toBeInTheDocument()
    expect(within(second!).getByText("Conflict")).toBeInTheDocument()
    expect(within(second!).getByText("Letter")).toBeInTheDocument()
    // No number: the document id stands in; no party, date or amount: dashes.
    expect(within(third!).getByText("DOC-000003")).toBeInTheDocument()
    expect(within(third!).getAllByText("—")).toHaveLength(2)
    expect(bodyRows()).toHaveLength(20)
    expect(screen.getByText("45 rows")).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument()
    expect(seen[0]?.get("limit")).toBe("20")
    expect(seen[0]?.get("offset")).toBe("0")
  })

  it("sends the URL filters and page to the API and labels the active party", async () => {
    const seen = recordListRequests()
    partyHandlers()
    renderRoute(<DocumentsPage />, `/documents?type=Invoice&status=Sent&partyId=${acmeEvents.id}&from=2025-01-01&to=2026-12-31&page=2&size=10`, { route: "/documents" })
    expect(await findCell("Invoice 13")).toBeInTheDocument()
    const q = seen.at(-1)!
    expect(Object.fromEntries(q)).toEqual({
      type: "Invoice",
      status: "Sent",
      partyId: String(acmeEvents.id),
      from: "2025-01-01",
      to: "2026-12-31",
      limit: "10",
      offset: "10",
    })
    expect(await screen.findByRole("button", { name: /Party.*Acme Events/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Type.*Invoice/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Date.*1 Jan 2025.*31 Dec 2026/ })).toBeInTheDocument()
    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument()
  })

  it("puts a chosen status in the URL, back on page 1, and refetches", async () => {
    const seen = recordListRequests()
    const { user, router } = renderRoute(<DocumentsPage />, "/documents?page=2", { route: "/documents" })
    await findCell("Invoice 23")
    await user.click(screen.getByRole("button", { name: "Status" }))
    await user.click(await screen.findByRole("option", { name: /Draft/ }))
    await waitFor(() => expect(search(router).get("status")).toBe("Draft"))
    expect(search(router).get("page")).toBeNull()
    await user.keyboard("{Escape}")
    expect(await findCell("Venue confirmation letter")).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(1)
    expect(seen.at(-1)?.get("status")).toBe("Draft")
    expect(seen.at(-1)?.get("offset")).toBe("0")
  })

  it("filters by party from the searchable list", async () => {
    recordListRequests()
    partyHandlers()
    const { user, router } = renderRoute(<DocumentsPage />, "/documents", { route: "/documents" })
    await findCell("Stage invoice")
    await user.click(screen.getByRole("button", { name: "Party" }))
    await user.type(await screen.findByPlaceholderText("Search parties…"), "alex")
    await user.click(await screen.findByRole("option", { name: /Alex Example/ }))
    await waitFor(() => expect(search(router).get("partyId")).toBe(String(alexExample.id)))
    expect(await findCell("Venue confirmation letter")).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(1)
  })

  it("pages with the pagination buttons through the URL", async () => {
    const seen = recordListRequests()
    const { user, router } = renderRoute(<DocumentsPage />, "/documents", { route: "/documents" })
    await findCell("Stage invoice")
    await user.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(search(router).get("page")).toBe("2"))
    expect(await findCell("Invoice 21")).toBeInTheDocument()
    expect(seen.at(-1)?.get("offset")).toBe("20")
  })

  it("resets every filter", async () => {
    recordListRequests()
    const { user, router } = renderRoute(<DocumentsPage />, "/documents?status=Paid&type=Quotation", { route: "/documents" })
    await findCell("Catering quotation")
    await user.click(screen.getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(router.state.location.search).toBe(""))
    expect(await findCell("Stage invoice")).toBeInTheDocument()
  })

  it("hides a column from the View menu and remembers it", async () => {
    recordListRequests()
    const { user, unmount } = renderRoute(<DocumentsPage />, "/documents", { route: "/documents" })
    await findCell("Stage invoice")
    await user.click(screen.getByRole("button", { name: "View" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Party" }))
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("columnheader", { name: "Party" })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem("dossier.documents.columns") ?? "{}")).toEqual({ party: false })
    unmount()
    renderRoute(<DocumentsPage />, "/documents", { route: "/documents" })
    await findCell("Stage invoice")
    expect(screen.queryByRole("columnheader", { name: "Party" })).not.toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Amount" })).toBeInTheDocument()
  })

  it("opens a document when its row is clicked", async () => {
    recordListRequests()
    const { user, router } = renderRoute(<DocumentsPage />, "/documents", { route: "/documents" })
    await findCell("Stage invoice")
    expect(screen.getByRole("link", { name: "Stage invoice" })).toHaveAttribute("href", "/documents/DOC-000001")
    await user.click(within(bodyRows()[0]!).getByText("Invoice"))
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000001"))
  })

  it("says when no document matches the filters", async () => {
    recordListRequests()
    renderRoute(<DocumentsPage />, "/documents?type=Receipt", { route: "/documents" })
    expect(await screen.findByText("No documents match these filters.")).toBeInTheDocument()
    expect(screen.getByText("0 rows")).toBeInTheDocument()
  })

  it("moves a page past the end to the last page", async () => {
    const seen = recordListRequests()
    const { router } = renderRoute(<DocumentsPage />, "/documents?page=99&status=Sent", { route: "/documents" })
    await waitFor(() => expect(search(router).get("page")).toBe("3"))
    expect(search(router).get("status")).toBe("Sent")
    expect(await findCell("Invoice 43")).toBeInTheDocument()
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument()
    expect(screen.queryByText(/No documents/)).not.toBeInTheDocument()
    expect(seen.at(-1)?.get("offset")).toBe("40")
  })

  it("shows the API error with a retry", async () => {
    server.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({ code: "INVALID_INPUT", message: "type must be a non-empty string", details: {} }, { status: 400 }),
      ),
    )
    renderRoute(<DocumentsPage />, "/documents?type=Invoice", { route: "/documents" })
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("INVALID_INPUT: type must be a non-empty string")).toBeInTheDocument()
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument()
  })
})
