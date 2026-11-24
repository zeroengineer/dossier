import { configure, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { acmeDocuments } from "@/test/fixtures-entities"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

let documentQueries: URLSearchParams[] = []

// `GET /api/documents?entityId=`: the documents table owns the default /api/documents handler, so this page's tests
// answer it themselves (Acme Events has two visible documents; everyone else none).
beforeEach(() => {
  documentQueries = []
  server.use(
    http.get("*/api/documents", ({ request }) => {
      const params = new URL(request.url).searchParams
      documentQueries.push(params)
      return HttpResponse.json({ documents: params.get("entityId") === "1" ? acmeDocuments : [] })
    }),
  )
})
// Lazy route chunks and dialogs can take over a second to appear on a loaded machine (parallel suites): allow
// 5 s per query and 20 s per test.
// Vitest isolates test files, so this only affects this file.
configure({ asyncUtilTimeout: 5000 })
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })

// The page is a lazy route chunk: load it once up front so the first test does not race its cold import.
beforeAll(async () => {
  await import("@/pages/entity")
})
afterEach(() => server.events.removeAllListeners())

const card = (title: string) => {
  const heading = screen.getByText(title, { selector: "[data-slot=card-title]" })
  return within(heading.closest<HTMLElement>("[data-slot=card]")!)
}

/** Captures the JSON body of the next POST to `path`. */
function capturePost(path: string) {
  const bodies: unknown[] = []
  server.events.on("request:start", async ({ request }) => {
    if (request.method === "POST" && new URL(request.url).pathname === path) bodies.push(await request.clone().json())
  })
  return bodies
}

describe("Entity page", () => {
  it("shows the entity's details, aliases, brand and attributes", async () => {
    renderApp("/entities/1")
    expect(await screen.findByRole("heading", { name: "Acme Events Private Limited" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Company" })).toHaveAttribute("href", "/entities?kind=company")
    expect(screen.getByText("Also known as Acme Events")).toBeInTheDocument()

    const details = within(screen.getByLabelText("Entity details"))
    expect(details.getByRole("link", { name: "acme" })).toHaveAttribute("href", "/settings/brands/acme")
    const attrs = within(screen.getByLabelText("Attributes"))
    expect(attrs.getByText("email")).toBeInTheDocument()
    expect(attrs.getByText("accounts@example.com")).toBeInTheDocument()
    expect(attrs.getByText("Example City")).toBeInTheDocument()
  })

  it("lists relations in both directions with links to the related entity", async () => {
    renderApp("/entities/1")
    await screen.findByRole("heading", { name: "Acme Events Private Limited" })
    const relations = card("Relations")
    const row = relations.getAllByRole("row")[1]!
    expect(row).toHaveTextContent("Alex Example employed by Acme Events Private Limited")
    expect(within(row).getByRole("link", { name: "Alex Example" })).toHaveAttribute("href", "/entities/2")
    expect(within(row).getByText("Person")).toBeInTheDocument()
    expect(within(row).getByText("since: 2025-01-01")).toBeInTheDocument()
  })

  it("lists the documents that refer to the entity and notes the ones it cannot show", async () => {
    renderApp("/entities/1")
    const docs = within(await screen.findByText("Documents", { selector: "[data-slot=card-title]" }).then((h) => h.closest<HTMLElement>("[data-slot=card]")!))
    expect(await docs.findByRole("link", { name: "Event services invoice" })).toHaveAttribute("href", "/documents/DOC-000001")
    expect(docs.getByRole("link", { name: "Venue confirmation letter" })).toBeInTheDocument()
    expect(docs.getByText("1 more document refers to this entity but is not listed (above your clearance).")).toBeInTheDocument()
    expect(documentQueries.some((p) => p.get("entityId") === "1" && p.get("limit") === "100")).toBe(true)
  })

  it("says so when there are no relations or documents", async () => {
    renderApp("/entities/4")
    await screen.findByRole("heading", { name: "Example Supplies" })
    expect(card("Relations").getByText("No relations yet.")).toBeInTheDocument()
    expect(await screen.findByText("No documents you can see refer to this entity.")).toBeInTheDocument()
  })

  it("shows a not-found state for an unknown id", async () => {
    renderApp("/entities/404")
    expect(await screen.findByRole("heading", { name: "Entity not found" })).toBeInTheDocument()
    expect(screen.getByText(/ENTITY_NOT_FOUND/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "All entities" })).toHaveAttribute("href", "/entities")
  })
})

describe("Edit entity dialog", () => {
  it("is prefilled, keeps existing aliases, and sends new aliases, removed attribute keys as null and a cleared brand", async () => {
    const bodies = capturePost("/api/entities")
    const { user } = renderApp("/entities/1")
    await screen.findByRole("heading", { name: "Acme Events Private Limited" })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const d = within(await screen.findByRole("dialog", { name: "Edit Acme Events Private Limited" }))

    expect(d.queryByRole("combobox", { name: "Kind" })).not.toBeInTheDocument()
    expect(d.getByLabelText("Name")).toHaveValue("Acme Events Private Limited")
    expect(d.queryByRole("button", { name: "Remove alias Acme Events" })).not.toBeInTheDocument()
    expect(d.getByLabelText("Attributes (JSON)")).toHaveValue(JSON.stringify({ email: "accounts@example.com", city: "Example City" }, null, 2))
    expect(d.getByRole("combobox", { name: "Brand" })).toHaveTextContent("Acme Events")

    await user.type(d.getByLabelText("Aliases"), "AEPL{Enter}")
    await user.clear(d.getByLabelText("Attributes (JSON)"))
    await user.type(d.getByLabelText("Attributes (JSON)"), '{{"email": "billing@example.com"}')
    await user.click(d.getByRole("combobox", { name: "Brand" }))
    await user.click(await screen.findByRole("option", { name: "None" }))
    await user.click(d.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(bodies).toEqual([
      { id: 1, name: "Acme Events Private Limited", aliases: ["AEPL"], attrs: { email: "billing@example.com", city: null }, brand: null },
    ])
  })

  it("shows the server's error and stays open", async () => {
    server.use(
      http.post("*/api/entities", () =>
        HttpResponse.json({ code: "INVALID_INPUT", message: 'name "!!" has no letters or digits', details: { name: "!!" } }, { status: 400 }),
      ),
    )
    const { user } = renderApp("/entities/2")
    await screen.findByRole("heading", { name: "Alex Example" })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Alex Example" })
    await user.clear(within(dialog).getByLabelText("Name"))
    await user.type(within(dialog).getByLabelText("Name"), "!!")
    await user.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(await within(dialog).findByText("INVALID_INPUT")).toBeInTheDocument()
    expect(within(dialog).getByText('name "!!" has no letters or digits')).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
  })
})

describe("Add relation dialog", () => {
  it("relates the entity to one picked by searching, with a role from meta", async () => {
    const bodies = capturePost("/api/entities/2/relations")
    const { user } = renderApp("/entities/2")
    await screen.findByRole("heading", { name: "Alex Example" })
    await user.click(screen.getByRole("button", { name: "Add relation" }))
    const dialog = await screen.findByRole("dialog", { name: "Add relation" })
    const d = within(dialog)

    await user.click(d.getByRole("button", { name: "Add relation" }))
    expect(await d.findByText("Relation is required")).toBeInTheDocument()
    expect(d.getByText("Related entity is required")).toBeInTheDocument()

    await user.click(d.getByRole("combobox", { name: "Relation" }))
    await user.click(await screen.findByRole("option", { name: "director of" }))

    await user.click(d.getByRole("combobox", { name: "Related entity" }))
    const search = await screen.findByRole("combobox", { name: "Search entities" })
    // The entity being related is never offered.
    await screen.findByRole("option", { name: /Acme Client Co/ })
    expect(screen.queryByRole("option", { name: /Alex Example/ })).not.toBeInTheDocument()
    await user.type(search, "acme events")
    await waitFor(() => expect(screen.queryByRole("option", { name: /Acme Client Co/ })).not.toBeInTheDocument())
    await user.click(screen.getByRole("option", { name: /Acme Events Private Limited/ }))

    expect(d.getByRole("combobox", { name: "Related entity" })).toHaveTextContent("Acme Events Private Limited (Company)")
    expect(d.getByTestId("relation-preview")).toHaveTextContent("Alex Example director of Acme Events Private Limited")
    await user.click(d.getByRole("button", { name: "Add relation" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(bodies).toEqual([{ to: 1, role: "director_of" }])
  })

  it("shows the server's error and stays open", async () => {
    server.use(
      http.post("*/api/entities/:id/relations", () =>
        HttpResponse.json({ code: "INVALID_INPUT", message: "An entity cannot be related to itself", details: {} }, { status: 400 }),
      ),
    )
    const { user } = renderApp("/entities/2")
    await screen.findByRole("heading", { name: "Alex Example" })
    await user.click(screen.getByRole("button", { name: "Add relation" }))
    const dialog = await screen.findByRole("dialog", { name: "Add relation" })
    const d = within(dialog)
    await user.click(d.getByRole("combobox", { name: "Relation" }))
    await user.click(await screen.findByRole("option", { name: "employed by" }))
    await user.click(d.getByRole("combobox", { name: "Related entity" }))
    await user.click(await screen.findByRole("option", { name: /Example Supplies/ }))
    await user.click(d.getByRole("button", { name: "Add relation" }))
    expect(await d.findByText("An entity cannot be related to itself")).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
  })
})
