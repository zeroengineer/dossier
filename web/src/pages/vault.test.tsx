import { screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

/** `node` params of every `/api/tree` request made during the test. */
let treeRequests: string[] = []
const onRequest = ({ request }: { request: Request }) => {
  const url = new URL(request.url)
  if (url.pathname === "/api/tree") treeRequests.push(url.searchParams.get("node") ?? "")
}

beforeEach(() => {
  treeRequests = []
  server.events.on("request:start", onRequest)
})
afterEach(() => {
  server.events.removeListener("request:start", onRequest)
})

/** Wait for the lazily loaded page (the first import can be slow under test). */
const ready = () => screen.findByRole("navigation", { name: "Folders" }, { timeout: 5000 })
const folders = () => within(screen.getByRole("navigation", { name: "Folders" }))
const folderLink = (name: string) => folders().getByRole("link", { name: new RegExp(`^${name}`) })

describe("Vault page", () => {
  it("lists the top-level folders and asks to choose one", async () => {
    renderApp("/vault")
    await ready()
    expect(await folders().findByRole("link", { name: /^01 Company/ })).toBeInTheDocument()
    expect(folderLink("03 Clients")).toHaveAttribute("href", "/vault/03")
    expect(screen.getByText("Choose a folder")).toBeInTheDocument()
    expect(treeRequests).toEqual([""])
  })

  it("loads a folder's subfolders lazily when it is expanded", async () => {
    const { user } = renderApp("/vault")
    await ready()
    await folders().findByRole("link", { name: /^03 Clients/ })
    expect(folders().queryByRole("link", { name: /^Events Line/ })).not.toBeInTheDocument()

    await user.click(folders().getByRole("button", { name: "Expand 03 Clients" }))
    expect(await folders().findByRole("link", { name: /^Events Line/ })).toBeInTheDocument()
    expect(treeRequests).toContain("03")
    expect(treeRequests).not.toContain("03/events")

    await user.click(folders().getByRole("button", { name: "Collapse 03 Clients" }))
    await waitFor(() => expect(folders().queryByRole("link", { name: /^Events Line/ })).not.toBeInTheDocument())
  })

  it("deep-links to a folder: ancestors expanded, breadcrumb, documents table, row opens the document", async () => {
    const { user, router } = renderApp("/vault/03/events/example-client/invoices-and-receipts")
    await ready()

    expect(await screen.findByRole("heading", { level: 2, name: "Invoices and Receipts" })).toBeInTheDocument()
    expect(await folders().findByRole("link", { name: /^Invoices and Receipts/ })).toHaveAttribute("aria-current", "page")
    expect(folders().getByRole("button", { name: "Collapse Example Client LLP" })).toBeInTheDocument()

    expect(await screen.findByRole("link", { name: "Example Client LLP" })).toHaveAttribute("href", "/vault/03/events/example-client")
    expect(screen.getByRole("link", { name: "Events Line" })).toHaveAttribute("href", "/vault/03/events")
    expect(screen.getByRole("link", { name: "03 Clients" })).toHaveAttribute("href", "/vault/03")
    expect(screen.getByText("2 documents")).toBeInTheDocument()

    const row = screen.getByText("2026-07-14_ExampleClientLLP_Invoice_ACM-2026-0001_v1.pdf").closest("tr")
    if (!row) throw new Error("no row")
    expect(within(row).getByText("Sent")).toBeInTheDocument()
    expect(within(row).getByText("Invoice")).toBeInTheDocument()
    expect(within(row).getByText("Internal")).toBeInTheDocument()

    await user.click(row)
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000001"))
  })

  it("selects a folder from the tree and updates the right pane", async () => {
    const { user, router } = renderApp("/vault/03/events/example-client/invoices-and-receipts")
    await ready()
    await user.click(await folders().findByRole("link", { name: /^Proposals and Pricing/ }))
    expect(router.state.location.pathname).toBe("/vault/03/events/example-client/proposals-and-pricing")
    expect(await screen.findByRole("heading", { level: 2, name: "Proposals and Pricing" })).toBeInTheDocument()
    expect(screen.getByText("2026-06-01_ExampleClientLLP_Proposal_v2.pdf")).toBeInTheDocument()
    expect(screen.getByText("1 document")).toBeInTheDocument()
  })

  it("shows an empty state for a folder without documents", async () => {
    renderApp("/vault/01/legal-and-registration")
    await ready()
    expect(await screen.findByText("This folder is empty")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("offers the subfolders of an empty folder that has some", async () => {
    renderApp("/vault/01")
    await ready()
    expect(await screen.findByText("This folder is empty")).toBeInTheDocument()
    const main = screen.getByText("This folder is empty").closest("[data-slot=empty]")
    if (!(main instanceof HTMLElement)) throw new Error("no empty state")
    expect(within(main).getByRole("link", { name: "Legal and Registration" })).toHaveAttribute("href", "/vault/01/legal-and-registration")
  })

  it("shows an error with a way back for an unknown folder", async () => {
    renderApp("/vault/03/nope")
    await ready()
    expect(await screen.findByText("Folder not found")).toBeInTheDocument()
    expect(screen.getByText(/NODE_NOT_FOUND/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to Vault" })).toHaveAttribute("href", "/vault")
  })
})
