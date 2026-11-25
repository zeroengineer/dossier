import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it } from "vitest"
import type { WorkspaceFile } from "@/api/types"
import { meta } from "@/test/fixtures"
import { defaultTopLevel, topKeys, workspaceFile } from "@/test/fixtures-settings"
import WorkspaceSettingsPage from "@/pages/settings-workspace"
import { renderRoute } from "@/test/render"
import { server } from "@/test/server"

function capturePuts() {
  const bodies: WorkspaceFile[] = []
  server.use(
    http.put("*/api/workspace", async ({ request }) => {
      const body = (await request.json()) as WorkspaceFile
      bodies.push(body)
      return HttpResponse.json({ workspace: body })
    }),
  )
  return bodies
}

const invalid = (errors: Array<{ file: string; path: string; message: string }>) =>
  HttpResponse.json({ code: "WORKSPACE_INVALID", message: "workspace.json: invalid", details: { file: "workspace.json", errors } }, { status: 400 })

async function openPage(path = "/settings/workspace") {
  const app = renderRoute(<WorkspaceSettingsPage />, path, { route: "/settings/workspace" })
  await screen.findByRole("form", { name: "Workspace settings" })
  return app
}

const saveButton = () => screen.getByRole("button", { name: "Save workspace" })
const userRow = (n: number) => screen.getByRole("group", { name: `user ${n}` })
const routeRow = (n: number) => screen.getByRole("group", { name: `route ${n}` })
const formAlert = () => document.querySelector<HTMLElement>("form [data-slot=alert]")!

beforeEach(() => {
  server.use(http.get("*/api/meta", () => HttpResponse.json({ ...meta, hierarchy: { ...meta.hierarchy, topLevel: defaultTopLevel, topKeys } })))
})

describe("Workspace settings", () => {
  it("loads workspace.json into the form", async () => {
    await openPage()
    expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeInTheDocument()
    expect(screen.getByLabelText("Workspace name")).toHaveValue("Example Workspace")
    expect(screen.getByLabelText("Default brand")).toHaveValue("acme")
    expect(screen.getByLabelText("Currency code")).toHaveValue("INR")
    expect(screen.getByLabelText("Number locale")).toHaveValue("")
    expect(screen.getByLabelText("Number locale")).toHaveAttribute("placeholder", "en-IN")
    expect(screen.getByLabelText("Folder 3 (clients)")).toHaveAttribute("placeholder", "03 Clients")
    expect(within(routeRow(1)).getByLabelText(/^Document type/)).toHaveValue("Invoice")
    expect(within(userRow(2)).getByLabelText(/^User id/)).toHaveValue("intern")
    expect(within(userRow(2)).getByLabelText(/^Clearance/)).toHaveValue("Internal")
    expect(screen.getByText(/above your own \(Confidential\)/)).toBeInTheDocument()
  })

  it("saves the whole file with PUT /api/workspace, keeping keys the form does not edit", async () => {
    const bodies = capturePuts()
    const { user } = await openPage()
    const name = screen.getByLabelText("Workspace name")
    await user.clear(name)
    await user.type(name, "Acme Workspace")
    await user.clear(screen.getByLabelText("Currency symbol"))
    await user.type(screen.getByLabelText("Folder 4 (vendors)"), "04 Suppliers")
    await user.click(screen.getByRole("button", { name: "Add route" }))
    await user.type(within(routeRow(2)).getByLabelText(/^Document type/), "NDA")
    await user.type(within(routeRow(2)).getByLabelText(/^Route/), "Agreements")
    await user.click(screen.getByRole("button", { name: "Add user" }))
    await user.type(within(userRow(3)).getByLabelText(/^User id/), "alex@example.com")
    await user.selectOptions(within(userRow(3)).getByLabelText(/^Clearance/), "Public")
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      ...workspaceFile,
      name: "Acme Workspace",
      locale: { currencyCode: "INR" },
      hierarchy: {
        topLevel: defaultTopLevel.map((n, i) => (i === 3 ? "04 Suppliers" : n)),
        routing: { Invoice: "Invoices and Receipts", NDA: "Agreements" },
      },
      users: { ...workspaceFile.users, "alex@example.com": { clearance: "Public" } },
    })
    expect(await screen.findByText("All changes saved.")).toBeInTheDocument()
  })

  it("shows clearance-rule errors on the user's row, and errors for removed users in the alert", async () => {
    server.use(
      http.put("*/api/workspace", () =>
        invalid([
          { file: "workspace.json", path: "users.intern.clearance", message: "would give intern clearance Restricted: above your own clearance (Confidential)" },
          { file: "workspace.json", path: "users.senior.clearance", message: "cannot remove a user with clearance Restricted: above your own clearance (Confidential)" },
        ]),
      ),
    )
    const { user } = await openPage()
    await user.selectOptions(within(userRow(2)).getByLabelText(/^Clearance/), "Restricted")
    await user.click(saveButton())
    const clearance = within(userRow(2)).getByLabelText(/^Clearance/)
    await waitFor(() => expect(clearance).toHaveAttribute("aria-invalid", "true"))
    expect(within(userRow(2)).getByText(/would give intern clearance Restricted: above your own clearance/)).toBeInTheDocument()
    expect(within(formAlert()).getByText(/users\.senior\.clearance: cannot remove a user with clearance Restricted/)).toBeInTheDocument()
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument()
  })

  it("puts locale, top-level and routing errors on their fields", async () => {
    server.use(
      http.put("*/api/workspace", () =>
        invalid([
          { file: "workspace.json", path: "locale.currencyCode", message: "must be a 3-letter ISO code" },
          { file: "workspace.json", path: "hierarchy.topLevel.1", message: "must not be empty" },
          { file: "workspace.json", path: "hierarchy.routing.Invoice", message: "cannot route to the Restricted folder" },
        ]),
      ),
    )
    const { user } = await openPage()
    await user.click(saveButton())
    expect(await screen.findByText("must be a 3-letter ISO code")).toBeInTheDocument()
    expect(screen.getByLabelText("Currency code")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText("Folder 2 (people)")).toHaveAttribute("aria-invalid", "true")
    expect(within(routeRow(1)).getByText("cannot route to the Restricted folder")).toBeInTheDocument()
  })

  it("asks before lowering your own clearance, and sends nothing on cancel", async () => {
    const bodies = capturePuts()
    const { user } = await openPage()
    await user.selectOptions(within(userRow(1)).getByLabelText(/^Clearance/), "Public")
    await user.click(saveButton())
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("You will lose access to Internal and Confidential and cannot raise it back yourself.")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(bodies).toHaveLength(0)
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument()
  })

  it("lowers your own clearance after confirming", async () => {
    const bodies = capturePuts()
    const { user } = await openPage()
    await user.selectOptions(within(userRow(1)).getByLabelText(/^Clearance/), "Public")
    await user.click(saveButton())
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Lower my clearance" }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]?.users?.["demo"]).toEqual({ clearance: "Public" })
  })

  it("does not ask when your clearance stays the same", async () => {
    const bodies = capturePuts()
    const { user } = await openPage()
    await user.selectOptions(within(userRow(2)).getByLabelText(/^Clearance/), "Public")
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("refuses duplicate users before sending", async () => {
    const bodies = capturePuts()
    const { user } = await openPage()
    const id = within(userRow(2)).getByLabelText(/^User id/)
    await user.clear(id)
    await user.type(id, "demo")
    await user.click(saveButton())
    expect(await within(userRow(2)).findByText('duplicate user "demo"')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it("marks the Users link active at #users", async () => {
    await openPage("/settings/workspace#users")
    const nav = screen.getByRole("navigation", { name: "Settings" })
    expect(within(nav).getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page")
    expect(document.getElementById("users")).toContainElement(screen.getByText("Users", { selector: "[data-slot=card-title]" }))
  })
})
