import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it } from "vitest"
import type { EntityMatch, TemplateDetail } from "@/api/types"
import { fieldKind } from "@/features/generate/schema"
import { builtinTemplateDetails, builtinTemplateList } from "@/test/fixtures-generate"
import GeneratePage from "@/pages/generate"
import { renderRoute } from "@/test/render"
import { server } from "@/test/server"

const entity = (id: number, kind: string, name: string): EntityMatch => ({
  id,
  kind,
  name,
  brand: null,
  aliases: [],
  matched: null,
})

// Example workspace entities (workspace.example/seeds/entities.json).
const entities = [
  entity(4, "client", "Demo Retail LLP"),
  entity(5, "client", "Example Institute of Sample Studies"),
  entity(6, "client", "Sample Society of Placeholders"),
  entity(7, "engagement", "Example Fest 2026 - Sample College"),
  entity(10, "person", "Jordan Placeholder"),
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** A label as rendered: the text, then an optional required marker. */
const label = (text: string) => new RegExp(`^${escape(text)}\\*?$`)

function detail(id: string): TemplateDetail {
  const d = builtinTemplateDetails[id]
  if (!d) throw new Error(`no fixture for ${id}`)
  return d
}


beforeEach(() => {
  server.use(
    http.get("*/api/entities", ({ request }) => {
      const kind = new URL(request.url).searchParams.get("kind")
      return HttpResponse.json({ entities: entities.filter((e) => e.kind === kind) })
    }),
  )
})

describe("Generate picker", () => {
  beforeEach(() => {
    server.use(http.get("*/api/templates", () => HttpResponse.json(builtinTemplateList)))
  })

  it("shows a card per template grouped by category, linking to its form", async () => {
    const { user, router } = renderRoute(<GeneratePage />, "/generate", { route: "/generate/:templateId?" })
    expect(await screen.findByRole("heading", { name: "Generate" })).toBeInTheDocument()
    const invoices = await screen.findByRole("region", { name: "Invoice" })
    expect(within(invoices).getByRole("link", { name: "Invoice" })).toHaveAttribute("href", "/generate/invoice")
    expect(within(invoices).getByRole("link", { name: "Debit note" })).toBeInTheDocument()
    const letters = screen.getByRole("region", { name: "Letter" })
    expect(within(letters).getByRole("link", { name: "Offer letter" })).toBeInTheDocument()
    expect(within(letters).queryByRole("link", { name: "Invoice" })).not.toBeInTheDocument()
    // Every built-in template has a card.
    expect(screen.getAllByRole("link", { name: (n) => builtinTemplateList.templates.some((t) => t.title === n) })).toHaveLength(
      builtinTemplateList.templates.length,
    )
    // Categories follow meta.templateCategories: invoice before letter.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(headings.indexOf("Invoice")).toBeLessThan(headings.indexOf("Letter"))

    await user.click(within(invoices).getByRole("link", { name: "Invoice" }))
    expect(router.state.location.pathname).toBe("/generate/invoice")
  })

  it("filters the cards by search and says when nothing matches", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate", { route: "/generate/:templateId?" })
    const search = await screen.findByRole("searchbox", { name: "Search templates" })
    await screen.findByRole("link", { name: "Invoice" })
    await user.type(search, "receipt")
    expect(screen.getByRole("link", { name: "Payment receipt" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Invoice" })).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, "no such template")
    expect(screen.getByText("No templates match")).toBeInTheDocument()
  })

  it("shows an empty state without templates", async () => {
    server.use(http.get("*/api/templates", () => HttpResponse.json({ templates: [], errors: [] })))
    renderRoute(<GeneratePage />, "/generate", { route: "/generate/:templateId?" })
    expect(await screen.findByText("No templates")).toBeInTheDocument()
  })
})

describe("Generate form", () => {
  it.each(Object.keys(builtinTemplateDetails))("renders every field of the built-in template %s", async (id) => {
    const t = detail(id)
    renderRoute(<GeneratePage />, `/generate/${id}`, { route: "/generate/:templateId?" })
    expect(await screen.findByRole("heading", { level: 1, name: t.meta.title })).toBeInTheDocument()
    const form = within(screen.getByRole("form", { name: `${t.meta.title} fields` }))
    for (const f of t.fields) {
      if (fieldKind(f) === "rows") {
        const table = form.getByRole("table", { name: label(f.label) })
        for (const column of Object.keys(f.item ?? {})) {
          expect(within(table).getByRole("columnheader", { name: new RegExp(`^${escape(column)} `) })).toBeInTheDocument()
        }
      } else {
        expect(form.getAllByLabelText(label(f.label)).length, f.name).toBeGreaterThan(0)
      }
    }
    expect(screen.getByText("Preview")).toBeInTheDocument()
  })

  it("asks for the template's fields for the sidebar's brand and lists the brands", async () => {
    window.localStorage.setItem("dossier.activeBrand", "acme-studio")
    const brands: (string | null)[] = []
    server.use(
      http.get("*/api/templates/:id", ({ request }) => {
        brands.push(new URL(request.url).searchParams.get("brandId"))
        return HttpResponse.json(detail("invoice"))
      }),
    )
    const { user } = renderRoute(<GeneratePage />, "/generate/invoice", { route: "/generate/:templateId?" })
    const brand = await screen.findByRole("combobox", { name: "Brand" })
    expect(brand).toHaveTextContent("Acme Studio LLP")
    expect(brands).toEqual(["acme-studio"])

    await user.click(brand)
    await user.click(await screen.findByRole("option", { name: "Acme Events Private Limited" }))
    await waitFor(() => expect(brands).toEqual(["acme-studio", "acme"]))
    expect(screen.getByRole("combobox", { name: "Brand" })).toHaveTextContent("Acme Events Private Limited")
  })

  it("keeps typed values when the brand changes", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate/invoice", { route: "/generate/:templateId?" })
    const bank = await screen.findByLabelText(label("Bank account"))
    await user.type(bank, "1")
    await user.click(screen.getByRole("combobox", { name: "Brand" }))
    await user.click(await screen.findByRole("option", { name: "Acme Studio LLP" }))
    expect(screen.getByRole("combobox", { name: "Brand" })).toHaveTextContent("Acme Studio LLP")
    expect(screen.getByLabelText(label("Bank account"))).toHaveValue("1")
  })

  it("adds and removes list rows", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate/invoice", { route: "/generate/:templateId?" })
    const items = await screen.findByRole("table", { name: label("Items") })
    expect(within(items).getAllByRole("row")).toHaveLength(2) // header + one blank row
    await user.type(within(items).getByRole("textbox", { name: "Items row 1 description" }), "Stage")
    await user.click(screen.getByRole("button", { name: "Add row" }))
    expect(within(items).getAllByRole("row")).toHaveLength(3)
    await user.type(within(items).getByRole("textbox", { name: "Items row 2 amount" }), "1,20,000")
    await user.click(within(items).getByRole("button", { name: "Remove Items row 1" }))
    expect(within(items).getAllByRole("row")).toHaveLength(2)
    expect(within(items).getByRole("textbox", { name: "Items row 1 amount" })).toHaveValue("1,20,000")
  })

  it("marks a required field the user left empty", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate/offer-letter", { route: "/generate/:templateId?" })
    const joining = await screen.findByLabelText(label("Joining date"))
    await user.click(joining)
    await user.tab()
    expect(await screen.findByText("Required")).toBeInTheDocument()
    expect(joining).toHaveAttribute("aria-invalid", "true")
  })

  it("flags invalid JSON in a list or object field", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate/mou", { route: "/generate/:templateId?" })
    const signatory = await screen.findByLabelText(label("Partner signatory"))
    await user.click(signatory)
    await user.paste("{ name")
    await user.tab()
    expect(await screen.findByText(/^not valid JSON/)).toBeInTheDocument()
  })

  it("starts switches at the template default", async () => {
    renderRoute(<GeneratePage />, "/generate/offer-letter", { route: "/generate/:templateId?" })
    expect(await screen.findByRole("switch", { name: label("Company seal") })).toBeChecked()
    expect(screen.getByRole("switch", { name: label("Probation applies") })).toBeChecked()
  })

  it("offers the entities of the field's kind", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate/invoice", { route: "/generate/:templateId?" })
    const client = await screen.findByRole("combobox", { name: label("Client") })
    await user.click(client)
    expect(await screen.findByRole("option", { name: "Demo Retail LLP" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Jordan Placeholder" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "Sample Society of Placeholders" }))
    await waitFor(() => expect(client).toHaveValue("Sample Society of Placeholders"))
  })

  it("offers the enum choices with the template default first", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate/invoice", { route: "/generate/:templateId?" })
    const tax = await screen.findByRole("combobox", { name: label("Tax") })
    await user.click(tax)
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(options).toEqual(["—", "none", "cgst_sgst", "igst"])
    await user.click(screen.getByRole("option", { name: "igst" }))
    expect(tax).toHaveTextContent("igst")
  })

  it("clears a choice the newly selected brand does not offer, and says so", async () => {
    // acme offers every tax mode; acme-studio (say, not GST-registered) only "none".
    const invoice = detail("invoice")
    const studio: TemplateDetail = {
      ...invoice,
      fields: invoice.fields.map((f) => (f.name === "taxMode" ? { ...f, choices: ["none"] } : f)),
    }
    server.use(
      http.get("*/api/templates/:id", ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get("brandId") === "acme-studio" ? studio : invoice),
      ),
    )
    const { user } = renderRoute(<GeneratePage />, "/generate/invoice", { route: "/generate/:templateId?" })
    const tax = await screen.findByRole("combobox", { name: label("Tax") })
    await user.click(tax)
    await user.click(await screen.findByRole("option", { name: "igst" }))
    expect(tax).toHaveTextContent("igst")

    await user.click(screen.getByRole("combobox", { name: "Brand" }))
    await user.click(await screen.findByRole("option", { name: "Acme Studio LLP" }))
    expect(await screen.findByText("Cleared Tax")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("combobox", { name: label("Tax") })).toHaveTextContent("—"))
    await user.click(screen.getByRole("combobox", { name: label("Tax") }))
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["—", "none"])
  })

  it("keeps a choice the new brand also offers", async () => {
    const { user } = renderRoute(<GeneratePage />, "/generate/invoice", { route: "/generate/:templateId?" })
    const tax = await screen.findByRole("combobox", { name: label("Tax") })
    await user.click(tax)
    await user.click(await screen.findByRole("option", { name: "none" }))
    await user.click(screen.getByRole("combobox", { name: "Brand" }))
    await user.click(await screen.findByRole("option", { name: "Acme Studio LLP" }))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Brand" })).toHaveTextContent("Acme Studio LLP"))
    // (Toasts are global to sonner, so a "Cleared" toast from an earlier test may still be listed: check the value.)
    expect(screen.getByRole("combobox", { name: label("Tax") })).toHaveTextContent("none")
  })

  it("says when the template does not exist", async () => {
    renderRoute(<GeneratePage />, "/generate/no-such-template", { route: "/generate/:templateId?" })
    expect(await screen.findByText("Template not found")).toBeInTheDocument()
  })
})
