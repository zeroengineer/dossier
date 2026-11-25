import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import type { SeriesEntry } from "@/api/types"
import { seriesFile } from "@/test/fixtures-settings"
import NumberingSettingsPage from "@/pages/settings-numbering"
import { renderRoute } from "@/test/render"
import { server } from "@/test/server"

function capturePuts() {
  const bodies: unknown[] = []
  server.use(
    http.put("*/api/series", async ({ request }) => {
      const body = (await request.json()) as { series: SeriesEntry[] }
      bodies.push(body)
      return HttpResponse.json({ series: body.series })
    }),
  )
  return bodies
}

const invalid = (errors: Array<{ file: string; path: string; message: string }>) =>
  HttpResponse.json({ code: "WORKSPACE_INVALID", message: "series.json: invalid", details: { file: "series.json", errors } }, { status: 400 })

async function openPage() {
  const app = renderRoute(<NumberingSettingsPage />, "/settings/numbering", { route: "/settings/numbering" })
  await screen.findByRole("form", { name: "Numbering series" })
  return app
}

const row = (n: number) => screen.getByRole("group", { name: `series ${n}` })
const saveButton = () => screen.getByRole("button", { name: "Save series" })

describe("Numbering settings", () => {
  it("lists the series as rows with their usage", async () => {
    await openPage()
    expect(screen.getByRole("heading", { level: 1, name: "Numbering" })).toBeInTheDocument()
    expect(within(row(1)).getByLabelText(/^Id/)).toHaveValue("invoice-main")
    expect(within(row(1)).getByLabelText(/^Pattern/)).toHaveValue("ACM-{YYYY}-{####}")
    expect(within(row(2)).getByLabelText(/^Shares the counter of/)).toHaveValue("invoice-main")
    expect(within(row(3)).getByLabelText(/^Counter restarts per/)).toHaveValue("global")
    expect(await within(row(1)).findByText("acme: invoice, acme-studio: invoice")).toBeInTheDocument()
    expect(within(row(3)).getByText("not used by any brand or template")).toBeInTheDocument()
    expect(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", { name: "Numbering" })).toHaveAttribute("aria-current", "page")
  })

  it("saves the whole list with PUT /api/series, dropping blank rows", async () => {
    const bodies = capturePuts()
    const { user } = await openPage()
    await user.click(screen.getByRole("button", { name: "Add series" }))
    await user.click(screen.getByRole("button", { name: "Add series" }))
    const fifth = row(5)
    await user.type(within(fifth).getByLabelText(/^Id/), "quote")
    await user.type(within(fifth).getByLabelText(/^Pattern/), "ACM-Q-{{YYYY}-{{###}")
    await user.selectOptions(within(fifth).getByLabelText(/^Shares the counter of/), "generic")
    await user.type(within(fifth).getByLabelText(/^Start/), "10")
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ series: [...seriesFile, { id: "quote", pattern: "ACM-Q-{YYYY}-{###}", start: 10, counter: "generic" }] })
    expect(await screen.findByText("All changes saved.")).toBeInTheDocument()
  })

  it("puts row errors like 3.pattern on the matching form row, even after blank rows were dropped", async () => {
    let sent: SeriesEntry[] = []
    server.use(
      http.put("*/api/series", async ({ request }) => {
        sent = ((await request.json()) as { series: SeriesEntry[] }).series
        return invalid([
          { file: "series.json", path: "3.pattern", message: "unknown token {PREFIX}" },
          { file: "series.json", path: "(root)", message: 'template "memo" would no longer load' },
          { file: "brands/acme/brand.json", path: "series.receipt", message: 'unknown series "receipt"' },
        ])
      }),
    )
    const { user } = await openPage()
    await user.click(screen.getByRole("button", { name: "Add series" })) // row 4 stays blank
    await user.click(screen.getByRole("button", { name: "Add series" }))
    await user.type(within(row(5)).getByLabelText(/^Id/), "bad")
    await user.type(within(row(5)).getByLabelText(/^Pattern/), "X-{{PREFIX}")
    await user.click(saveButton())
    await waitFor(() => expect(sent).toHaveLength(4))
    const pattern = within(row(5)).getByLabelText(/^Pattern/)
    await waitFor(() => expect(pattern).toHaveAttribute("aria-invalid", "true"))
    expect(within(row(5)).getByText("unknown token {PREFIX}")).toBeInTheDocument()
    const alert = document.querySelector<HTMLElement>("form [data-slot=alert]")!
    expect(within(alert).getByText('(root): template "memo" would no longer load')).toBeInTheDocument()
    expect(within(alert).getByText('brands/acme/brand.json series.receipt: unknown series "receipt"')).toBeInTheDocument()

    // Discard undoes the edits and clears the "Not saved" alert.
    await user.click(screen.getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(document.querySelector("form [data-slot=alert]")).toBeNull())
    expect(screen.queryByRole("group", { name: "series 5" })).not.toBeInTheDocument()
  })

  it("says the usage is unavailable when it cannot be loaded", async () => {
    server.use(http.get("*/api/series/usage", () => HttpResponse.json({ code: "INTERNAL", message: "boom", details: {} }, { status: 500 })))
    await openPage()
    expect(await within(row(1)).findByText("Usage unavailable")).toBeInTheDocument()
  })

  it("refuses a start that is not a whole number before sending", async () => {
    const bodies = capturePuts()
    const { user } = await openPage()
    const start = within(row(1)).getByLabelText(/^Start/)
    await user.clear(start)
    await user.type(start, "one")
    await user.click(saveButton())
    expect(await within(row(1)).findByText("must be a whole number")).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it("shows an error state when the series cannot be loaded", async () => {
    server.use(http.get("*/api/series", () => HttpResponse.json({ code: "INTERNAL", message: "boom", details: {} }, { status: 500 })))
    renderRoute(<NumberingSettingsPage />, "/settings/numbering", { route: "/settings/numbering" })
    expect(await screen.findByText("Could not load the numbering series")).toBeInTheDocument()
  })
})
