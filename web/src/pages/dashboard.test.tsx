import { screen, waitFor, within } from "@testing-library/react"
import { delay, http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import DashboardPage from "@/pages/dashboard"
import { dashboardFixture } from "@/test/fixtures-dashboard"
import { renderApp, renderRoute } from "@/test/render"
import { server } from "@/test/server"

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
    renderRoute(<DashboardPage />, "/dashboard")
    const documents = await screen.findByTestId("kpi-documents")
    expect(within(documents).getByText("3")).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-drafts")).getByText("4")).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-invoiced")).getByText("₹12,500.00")).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-invoiced")).getByText(/Also \$500\.00/)).toBeInTheDocument()
    expect(within(screen.getByTestId("kpi-conflicts")).getByText("1")).toBeInTheDocument()
  })

  it("shows delta pills only from the previous period the API sends", async () => {
    renderRoute(<DashboardPage />, "/dashboard")
    const documents = await screen.findByTestId("kpi-documents")
    const up = within(documents).getByText("vs the previous 30 days (2)").closest("[data-direction]")
    expect(up).toHaveTextContent("+50%")
    expect(up).toHaveAttribute("data-direction", "up")
    const down = within(screen.getByTestId("kpi-invoiced")).getByText("vs the previous 30 days (₹25,000.00)").closest("[data-direction]")
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
    renderRoute(<DashboardPage />, "/dashboard")
    const documents = await screen.findByTestId("kpi-documents")
    expect(within(documents).queryByText(/%/)).toBeNull()
    expect(within(screen.getByTestId("kpi-invoiced")).queryByText(/%/)).toBeNull()
  })

  it("shows a −100% pill when nothing was invoiced this period but something was in the previous one", async () => {
    const base = dashboardFixture(30)
    server.use(http.get("*/api/dashboard", () => HttpResponse.json({ ...base, kpis: { ...base.kpis, invoiced: [] } })))
    renderRoute(<DashboardPage />, "/dashboard")
    const invoiced = await screen.findByTestId("kpi-invoiced")
    expect(within(invoiced).getByText("₹0.00")).toBeInTheDocument()
    const down = within(invoiced).getByText("vs the previous 30 days (₹25,000.00)").closest("[data-direction]")
    expect(down).toHaveTextContent("−100%")
    expect(down).toHaveAttribute("data-direction", "down")
  })

  it("renders on the index route too", async () => {
    renderApp("/")
    expect(await screen.findByTestId("kpi-documents")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument()
  })

  it("lists recent documents with number, title link and status", async () => {
    renderRoute(<DashboardPage />, "/dashboard")
    const link = await screen.findByRole("link", { name: "Invoice for stage design" })
    expect(link).toHaveAttribute("href", "/documents/DOC-000003")
    const row = link.closest("tr")
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText("ACM-INV-2026-003")).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText("Sent")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Engagement letter" })).toBeInTheDocument()
  })

  it("shows series counters and warnings with links", async () => {
    renderRoute(<DashboardPage />, "/dashboard")
    expect(await screen.findByText("acme:2026")).toBeInTheDocument()
    const warnings = screen.getByRole("list", { name: "Warnings" })
    // Static list items: not announced as live alerts.
    expect(within(warnings).queryByRole("alert")).toBeNull()
    expect(within(warnings).getByText("Number conflict")).toBeInTheDocument()
    expect(within(warnings).getByRole("link", { name: /Fix/ })).toHaveAttribute("href", "/documents/DOC-000003")
  })

  it("renders the documents chart", async () => {
    renderRoute(<DashboardPage />, "/dashboard")
    expect(await screen.findByText("Documents over time")).toBeInTheDocument()
    expect(await screen.findByTestId("documents-chart")).toBeInTheDocument()
  })

  it("gives the chart a text alternative: a summary and a table of every day", async () => {
    renderRoute(<DashboardPage />, "/dashboard")
    const summary = await screen.findByTestId("documents-chart-summary")
    expect(summary).toHaveClass("sr-only")
    expect(summary).toHaveTextContent("3 documents in this range. Busiest day: 28 Apr 2026, with 2.")
    const table = within(summary).getByRole("table", { name: "Documents per day" })
    expect(within(table).getAllByRole("row")).toHaveLength(31)
    expect(within(table).getByRole("rowheader", { name: "28 Apr 2026" }).nextElementSibling).toHaveTextContent("2")
  })

  it("summarises the 90-day chart by week", async () => {
    renderRoute(<DashboardPage />, "/dashboard?days=90")
    const summary = await screen.findByTestId("documents-chart-summary")
    expect(summary).toHaveTextContent(/Busiest week: Week of .+, with 2\./)
    expect(within(summary).getByRole("table", { name: "Documents per week" })).toBeInTheDocument()
  })

  it("refetches when the range changes and keeps it in the URL", async () => {
    const seen = trackDays()
    const { user, router } = renderRoute(<DashboardPage />, "/dashboard")
    await screen.findByTestId("kpi-documents")
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
    renderRoute(<DashboardPage />, "/dashboard?days=90")
    await screen.findByTestId("kpi-documents")
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
    renderRoute(<DashboardPage />, "/dashboard")
    expect(await screen.findByLabelText("Loading dashboard")).toBeInTheDocument()
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
    renderRoute(<DashboardPage />, "/dashboard")
    expect(await screen.findByText("No documents yet")).toBeInTheDocument()
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
    renderRoute(<DashboardPage />, "/dashboard")
    expect(await screen.findByText("The dashboard could not load")).toBeInTheDocument()
    expect(screen.getByText(/Database unavailable/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument()
  })
})
