import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"
import { templateList } from "@/test/fixtures-templates"

/** Body rows of the templates table (the header row excluded). */
const rowsNow = () => within(screen.getByRole("table")).getAllByRole("row").slice(1)

/** Waits for the loaded table, then returns its body rows. */
async function bodyRows() {
  await screen.findByRole("link", { name: "Generate Invoice" })
  return rowsNow()
}

/** The template a row shows, read from its Generate link's label. */
const titleOf = (row: HTMLElement) => within(row).getByRole("link", { name: /^Generate / }).getAttribute("aria-label")?.replace(/^Generate /, "")

/** A faceted filter button in the toolbar (the column headers have sort buttons with the same name). */
const filterButton = (name: string) => {
  const button = screen.getAllByRole("button", { name: new RegExp(`^${name}`) }).find((b) => !b.closest("table"))
  if (!button) throw new Error(`no ${name} filter`)
  return button
}

const rowOf = (rows: HTMLElement[], title: string) => {
  const row = rows.find((r) => titleOf(r) === title)
  if (!row) throw new Error(`no row for ${title}`)
  return within(row)
}

describe("Templates page", () => {
  it("lists templates with category, type, version, numbering, renditions, sensitivity and source", async () => {
    renderApp("/templates")
    expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument()
    const rows = await bodyRows()
    expect(rows).toHaveLength(3)

    const invoice = rowOf(rows, "Invoice")
    expect(invoice.getByText("Tax invoice with line items and the bank account to pay into.")).toBeInTheDocument()
    expect(invoice.getByText("v1")).toBeInTheDocument()
    expect(invoice.getByText("Brand series")).toBeInTheDocument()
    expect(invoice.getByText("pdf")).toBeInTheDocument()
    expect(invoice.getByText("html")).toBeInTheDocument()
    expect(invoice.getByText("Internal")).toBeInTheDocument()
    expect(invoice.getByText("Built-in")).toBeInTheDocument()

    const offer = rowOf(rows, "Offer letter")
    expect(offer.getByText("Letter")).toBeInTheDocument()
    expect(offer.getByText("Offer Letter")).toBeInTheDocument()
    expect(offer.getByText("v2")).toBeInTheDocument()
    expect(offer.getByText("Brand series (optional)")).toBeInTheDocument()
    expect(offer.getByText("Confidential")).toBeInTheDocument()
    expect(offer.getByText("Inherited")).toBeInTheDocument()

    const brief = rowOf(rows, "Event brief")
    expect(brief.getByText("None")).toBeInTheDocument()
    expect(brief.getByText("Workspace")).toBeInTheDocument()
  })

  it("groups rows by category by default", async () => {
    renderApp("/templates")
    const rows = await bodyRows()
    const titles = rows.map(titleOf)
    expect(titles).toEqual(["Invoice", "Offer letter", "Event brief"])
  })

  it("shows template load errors with id and message", async () => {
    renderApp("/templates")
    const alert = await screen.findByText("1 template failed to load")
    const box = alert.closest<HTMLElement>("[data-slot=alert]")!
    const items = within(box).getAllByTestId("template-error")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent("broken-memo")
    expect(items[0]).toHaveTextContent("TEMPLATE_INVALID")
    expect(items[0]).toHaveTextContent("templates/broken-memo/template.json: category: required")
  })

  it("shows no errors alert when every template loads", async () => {
    server.use(http.get("*/api/templates", () => HttpResponse.json({ ...templateList, errors: [] })))
    renderApp("/templates")
    await bodyRows()
    expect(screen.queryByText(/failed to load/)).not.toBeInTheDocument()
  })

  it("filters by category and by source", async () => {
    const { user } = renderApp("/templates")
    await bodyRows()
    await user.click(filterButton("Category"))
    await user.click(await screen.findByRole("option", { name: /Letter/ }))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(rowsNow()).toHaveLength(1))
    expect(screen.getByText("Offer letter")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Reset" }))
    await user.click(filterButton("Source"))
    await user.click(await screen.findByRole("option", { name: /Workspace/ }))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(rowsNow().map(titleOf)).toEqual(["Event brief"]))
  })

  it("links Generate to /generate/:id and navigates there on row click", async () => {
    const { user, router } = renderApp("/templates")
    await bodyRows()
    expect(screen.getByRole("link", { name: "Generate Invoice" })).toHaveAttribute("href", "/generate/invoice")
    expect(screen.getByRole("link", { name: "Invoice" })).toHaveAttribute("href", "/generate/invoice")
    await user.click(screen.getByText("Event brief"))
    await waitFor(() => expect(router.state.location.pathname).toBe("/generate/event-brief"))
  })

  it("shows an empty state when there are no templates", async () => {
    server.use(http.get("*/api/templates", () => HttpResponse.json({ templates: [], errors: [] })))
    renderApp("/templates")
    expect(await screen.findByText("No templates")).toBeInTheDocument()
  })

  it("shows an error state with retry when the request fails", async () => {
    server.use(
      http.get("*/api/templates", () =>
        HttpResponse.json({ code: "INTERNAL", message: "Something broke", details: {} }, { status: 500 }),
      ),
    )
    renderApp("/templates")
    expect(await screen.findByText("Could not load templates")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
