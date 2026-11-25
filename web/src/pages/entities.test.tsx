import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import type { EntityInput } from "@/api/types"
import EntitiesPage from "@/pages/entities"
import { renderRoute } from "@/test/render"
import { server } from "@/test/server"

afterEach(() => server.events.removeAllListeners())

/** Body rows of the entities table (the header row excluded). */
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1)

async function loaded() {
  await screen.findByRole("link", { name: "Acme Events Private Limited" })
}

/** Records the query strings of `GET /api/entities` while still answering from the default handler. */
function recordListRequests() {
  const seen: URLSearchParams[] = []
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/api/entities") seen.push(url.searchParams)
  })
  return seen
}

describe("Entities page", () => {
  it("lists every entity with name link, aliases, kind and document count, with a tab per kind from meta", async () => {
    renderRoute(<EntitiesPage />, "/entities", { route: "/entities" })
    expect(await screen.findByRole("heading", { name: "Entities" })).toBeInTheDocument()
    await loaded()

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabs).toEqual(["All", "Company", "Group entity", "Person", "Client", "Vendor", "Product", "Business line", "Engagement", "Financial year"])
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true")

    const rows = bodyRows()
    expect(rows).toHaveLength(4)
    const acme = within(rows.find((r) => r.textContent?.includes("Acme Events Private Limited"))!)
    expect(acme.getByRole("link", { name: "Acme Events Private Limited" })).toHaveAttribute("href", "/entities/1")
    expect(acme.getByText("Acme Events")).toBeInTheDocument()
    expect(acme.getByText("Company")).toBeInTheDocument()
    expect(acme.getByText("3")).toBeInTheDocument()
  })

  it("switches kind with the tabs, keeps it in the URL and asks the API for that kind", async () => {
    const seen = recordListRequests()
    const { user, router } = renderRoute(<EntitiesPage />, "/entities", { route: "/entities" })
    await loaded()

    await user.click(screen.getByRole("tab", { name: "Client" }))
    await waitFor(() => expect(router.state.location.search).toBe("?kind=client"))
    await screen.findByRole("link", { name: "Acme Client Co" })
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(seen.some((p) => p.get("kind") === "client" && p.get("limit") === "500")).toBe(true)
    // A single-kind tab hides the kind column.
    expect(within(screen.getByRole("table")).queryByRole("button", { name: /^Kind/ })).not.toBeInTheDocument()
  })

  it("opens on the tab of ?kind= and shows an empty state for a kind with no entities", async () => {
    renderRoute(<EntitiesPage />, "/entities?kind=product", { route: "/entities" })
    expect(await screen.findByText("No product entities")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Product" })).toHaveAttribute("aria-selected", "true")
  })

  it("searches names and aliases", async () => {
    const { user } = renderRoute(<EntitiesPage />, "/entities", { route: "/entities" })
    await loaded()
    await user.type(screen.getByPlaceholderText("Search names and aliases…"), "acc")
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(screen.getByRole("link", { name: "Acme Client Co" })).toBeInTheDocument()
  })

  it("opens an entity from its row", async () => {
    const { user, router } = renderRoute(<EntitiesPage />, "/entities", { route: "/entities" })
    await loaded()
    await user.click(screen.getByText("Example Supplies").closest("tr")!)
    await waitFor(() => expect(router.state.location.pathname).toBe("/entities/4"))
  })

  it("shows the API error for an unknown kind", async () => {
    renderRoute(<EntitiesPage />, "/entities?kind=planet", { route: "/entities" })
    expect(await screen.findByText("Could not load entities")).toBeInTheDocument()
    expect(screen.getByText(/INVALID_INPUT: Unknown entity kind "planet"/)).toBeInTheDocument()
  })
})

describe("New entity dialog", () => {
  it("validates attributes JSON, then creates the entity with aliases and opens it", async () => {
    let body: EntityInput | null = null
    server.events.on("request:start", async ({ request }) => {
      if (request.method === "POST" && new URL(request.url).pathname === "/api/entities") body = (await request.clone().json()) as EntityInput
    })
    const { user, router } = renderRoute(<EntitiesPage />, "/entities?kind=vendor", { route: "/entities" })
    await screen.findByRole("link", { name: "Example Supplies" })

    await user.click(screen.getByRole("button", { name: "New entity" }))
    const dialog = await screen.findByRole("dialog", { name: "New entity" })
    const d = within(dialog)
    expect(d.getByRole("combobox", { name: "Kind" })).toHaveTextContent("Vendor")

    await user.type(d.getByLabelText("Name"), "Sample Catering Co")
    const aliases = d.getByLabelText("Aliases")
    await user.type(aliases, "SCC{Enter}Catering, Caterers{Enter}")
    expect(within(d.getByRole("list", { name: "Alias list" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "SCC",
      "Catering",
      "Caterers",
    ])
    await user.click(d.getByRole("button", { name: "Remove alias Caterers" }))

    await user.type(d.getByLabelText("Attributes (JSON)"), "[[1]")
    await user.click(d.getByRole("button", { name: "Create" }))
    expect(await d.findByText(/Attributes must be a JSON object/)).toBeInTheDocument()
    expect(body).toBeNull()

    await user.clear(d.getByLabelText("Attributes (JSON)"))
    await user.type(d.getByLabelText("Attributes (JSON)"), '{{"email": "events@example.com"}')
    await user.click(d.getByRole("button", { name: "Create" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/entities/99"))
    expect(body).toEqual({ kind: "vendor", name: "Sample Catering Co", aliases: ["SCC", "Catering"], attrs: { email: "events@example.com" } })
  })

  it("requires a kind and a name", async () => {
    const { user } = renderRoute(<EntitiesPage />, "/entities", { route: "/entities" })
    await loaded()
    await user.click(screen.getByRole("button", { name: "New entity" }))
    const d = within(await screen.findByRole("dialog", { name: "New entity" }))
    await user.click(d.getByRole("button", { name: "Create" }))
    expect(await d.findByText("Kind is required")).toBeInTheDocument()
    expect(d.getByText("Name is required")).toBeInTheDocument()
  })

  it("chooses the kind and brand from meta and me", async () => {
    let body: EntityInput | null = null
    server.use(
      http.post("*/api/entities", async ({ request }) => {
        body = (await request.json()) as EntityInput
        return HttpResponse.json({ id: 98, kind: "company", name: "Acme Studio LLP", key: "acme studio llp", brand: "acme-studio", attrs: {}, aliases: [], relations: [], documentCount: 0, createdAt: "2026-04-03T09:00:00.000Z", updatedAt: "2026-04-03T09:00:00.000Z" }, { status: 201 })
      }),
    )
    const { user, router } = renderRoute(<EntitiesPage />, "/entities", { route: "/entities" })
    await loaded()
    await user.click(screen.getByRole("button", { name: "New entity" }))
    const d = within(await screen.findByRole("dialog", { name: "New entity" }))
    await user.click(d.getByRole("combobox", { name: "Kind" }))
    await user.click(await screen.findByRole("option", { name: "Company" }))
    await user.type(d.getByLabelText("Name"), "Acme Studio LLP")
    await user.click(d.getByRole("combobox", { name: "Brand" }))
    await user.click(await screen.findByRole("option", { name: "Acme Studio" }))
    await user.click(d.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/entities/98"))
    expect(body).toEqual({ kind: "company", name: "Acme Studio LLP", brand: "acme-studio" })
  })

  it("shows a duplicate name error with a link to the existing entity and stays open", async () => {
    const { user } = renderRoute(<EntitiesPage />, "/entities?kind=client", { route: "/entities" })
    await screen.findByRole("link", { name: "Acme Client Co" })
    await user.click(screen.getByRole("button", { name: "New entity" }))
    const dialog = await screen.findByRole("dialog", { name: "New entity" })
    const d = within(dialog)
    await user.type(d.getByLabelText("Name"), "ACC")
    await user.click(d.getByRole("button", { name: "Create" }))
    expect(await d.findByText("ENTITY_DUPLICATE")).toBeInTheDocument()
    expect(d.getByText(/already names client "Acme Client Co"/)).toBeInTheDocument()
    expect(d.getByRole("link", { name: "Open the existing entity" })).toHaveAttribute("href", "/entities/3")
    expect(dialog).toBeInTheDocument()
  })
})
