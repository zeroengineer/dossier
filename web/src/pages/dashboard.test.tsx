import { screen, waitFor, within } from "@testing-library/react"
import { delay, http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import { dashboardFixture } from "@/test/fixtures-dashboard"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

/** The page and its chart are lazy chunks: allow for a cold module transform on the first render. */
const LOAD = { timeout: 5000 }

/** Record the `days` of every dashboard request. */
function trackDays() {
  const seen: string[] = []
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url)
    if (url.pathname === "/api/dashboard") seen.push(url.searchParams.get("days") ?? "")
  })
  return seen
}

describe("Dashboard page", () => {
  afterEach(() => server.events.removeAllListeners())

  it("shows the KPI cards from /api/dashboard", async () => {
    renderApp("/dashboard")
    const documents = await screen.findByTestId("kpi-documents", undefined, LOAD)
    expect(within(documents).getByText("3")).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-drafts")).getByText("4")).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-invoiced")).getByText("₹12,500.00")).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-invoiced")).getByText(/Also \$500\.00/)).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-conflicts")).getByText("1")).toBeInTheDocument()
  })

  it("shows delta pills only from the previous period the API sends", async () => {
    renderApp("/dashboard")
    const documents = await screen.findByTestId("kpi-documents", undefined, LOAD)
    const up = within(documents).getByLabelText("2 in the previous 30 days")
    expect(up).toHaveTextContent("+50%")
    expect(up).toHaveAttribute("data-direction", "up")
    const down = within(screen.getByTestId("kpi-invoiced")).getByLabelText(/in the previous 30 days/)
    expect(down).toHaveTextContent("−50%")
    expect(down).toHaveAttribute("data-direction", "down")
    // Drafts and conflicts are all-time figures without a previous period: no pill.
    expect(within(screen.getByTestId("kpi-drafts")).queryByText(/%/)).toBeNull()
    expect(within(screen.getByTestId("kpi-conflicts")).queryByText(/%/)).toBeNull()
  })

  it("shows no pill when the previous period had nothing", async () => {
    server.use(
      http.get("*/api/dashboard", () =>
        HttpResponse.json(dashboardFixture(30, { previous: { from: "2026-03-02", to: "2026-03-31", documents: 0, invoiced: [] } })),
      ),
    )
    renderApp("/dashboard")
    const documents = await screen.findByTestId("kpi-documents", undefined, LOAD)
    expect(within(documents).queryByText(/%/)).toBeNull()
    expect(within(screen.getByTestId("kpi-invoiced")).queryByText(/%/)).toBeNull()
  })

  it("renders on the index route too", async () => {
    renderApp("/")
    expect(await screen.findByTestId("kpi-documents", undefined, LOAD)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument()
  })

  it("lists recent documents with number, title link and status", async () => {
    renderApp("/dashboard")
    const link = await screen.findByRole("link", { name: "Invoice for stage design" }, LOAD)
    expect(link).toHaveAttribute("href", "/documents/DOC-000003")
    const row = link.closest("tr")
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText("ACM-INV-2026-003")).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText("Sent")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Engagement letter" })).toBeInTheDocument()
  })

  it("shows series counters and warnings with links", async () => {
    renderApp("/dashboard")
    expect(await screen.findByText("acme:2026", undefined, LOAD)).toBeInTheDocument()
    const warnings = screen.getByRole("list", { name: "Warnings" })
    expect(within(warnings).getByText("Number conflict")).toBeInTheDocument()
    expect(within(warnings).getByRole("link", { name: /Fix/ })).toHaveAttribute("href", "/documents/DOC-000003")
  })

  it("renders the documents chart", async () => {
    renderApp("/dashboard")
    expect(await screen.findByText("Documents over time", undefined, LOAD)).toBeInTheDocument()
    expect(await screen.findByTestId("documents-chart", undefined, LOAD)).toBeInTheDocument()
  })

  it("refetches when the range changes and keeps it in the URL", async () => {
    const seen = trackDays()
    const { user, router } = renderApp("/dashboard")
    await screen.findByTestId("kpi-documents", undefined, LOAD)
    expect(seen).toEqual(["30"])
    expect(screen.getByRole("radio", { name: "Last 30 days" })).toHaveAttribute("data-state", "on")

    await user.click(screen.getByRole("radio", { name: "Last 7 days" }))
    await waitFor(() => expect(seen).toContain("7"))
    expect(router.state.location.search).toBe("?days=7")
    await waitFor(() => expect(within(screen.getByTestId("kpi-documents")).getByText(/In the last 7 days/)).toBeInTheDocument())

    await user.click(screen.getByRole("radio", { name: "Last 90 days" }))
    await waitFor(() => expect(seen).toContain("90"))
    await waitFor(() => expect(screen.getByText(/by week/)).toBeInTheDocument())
  })

  it("reads the range from ?days=", async () => {
    const seen = trackDays()
    renderApp("/dashboard?days=90")
    await screen.findByTestId("kpi-documents", undefined, LOAD)
    expect(seen).toEqual(["90"])
    expect(screen.getByRole("radio", { name: "Last 90 days" })).toHaveAttribute("data-state", "on")
  })

  it("shows skeletons while loading", async () => {
    server.use(
      http.get("*/api/dashboard", async () => {
        await delay("infinite")
        return HttpResponse.json(dashboardFixture())
      }),
    )
    renderApp("/dashboard")
    expect(await screen.findByLabelText("Loading dashboard", undefined, LOAD)).toBeInTheDocument()
  })

  it("shows an empty state when there are no documents", async () => {
    server.use(
      http.get("*/api/dashboard", () =>
        HttpResponse.json(
          dashboardFixture(30, {
            kpis: { documents: 0, drafts: 0, invoiced: [], numberConflicts: 0 },
            previous: { from: "2026-03-02", to: "2026-03-31", documents: 0, invoiced: [] },
            timeline: [],
            recent: [],
            counters: [],
            warnings: [],
          }),
        ),
      ),
    )
    renderApp("/dashboard")
    expect(await screen.findByText("No documents yet", undefined, LOAD)).toBeInTheDocument()
    const empty = screen.getByText("No documents yet").closest("[data-slot=empty]") as HTMLElement
    expect(within(empty).getByRole("link", { name: "Generate" })).toHaveAttribute("href", "/generate")
    expect(within(empty).getByRole("link", { name: "Upload" })).toHaveAttribute("href", "/upload")
    expect(screen.queryByText("Documents over time")).toBeNull()
    expect(within(screen.getByTestId("kpi-invoiced")).getByText("₹0.00")).toBeInTheDocument()
    expect(screen.getByText("No warnings")).toBeInTheDocument()
  })

  it("shows an error state with retry when the API fails", async () => {
    server.use(
      http.get("*/api/dashboard", () =>
        HttpResponse.json({ code: "INTERNAL", message: "Database unavailable", details: {} }, { status: 500 }),
      ),
    )
    renderApp("/dashboard")
    expect(await screen.findByText("The dashboard could not load", undefined, LOAD)).toBeInTheDocument()
    expect(screen.getByText(/Database unavailable/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument()
  })
})
