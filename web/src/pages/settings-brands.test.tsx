import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import type { BrandFile } from "@/api/types"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

describe("Brands settings page", () => {
  it("lists the brands with their parent, preview and download links", async () => {
    renderApp("/settings/brands")
    expect(await screen.findByRole("heading", { name: "Brands" })).toBeInTheDocument()
    const table = screen.getByRole("table")
    expect(await within(table).findByRole("link", { name: "acme-studio" })).toHaveAttribute("href", "/settings/brands/acme-studio")
    expect(within(table).getByText("Acme Studio LLP")).toBeInTheDocument()
    expect(within(table).getByRole("link", { name: "Download brand.json of acme" })).toHaveAttribute("href", "/api/brands/acme/file")
    expect(within(table).getByRole("link", { name: "Letterhead preview of acme" })).toHaveAttribute("href", "/api/brands/acme/preview.pdf")
    const nav = screen.getByRole("navigation", { name: "Settings" })
    expect(within(nav).getByRole("link", { name: "Brands" })).toHaveAttribute("aria-current", "page")
  })

  it("creates a brand with only the filled-in fields of an inheriting brand and opens it", async () => {
    let sent: BrandFile | null = null
    server.use(
      http.post("*/api/brands", async ({ request }) => {
        const body = (await request.json()) as BrandFile
        sent = body
        return HttpResponse.json({ id: body.id, file: body, resolved: {}, configHash: "x" }, { status: 201 })
      }),
    )
    const { user, router } = renderApp("/settings/brands")
    await user.click(await screen.findByRole("button", { name: "New brand" }))
    const dialog = await screen.findByRole("dialog", { name: "New brand" })
    await user.type(within(dialog).getByLabelText("Id"), "acme-north")
    await user.selectOptions(within(dialog).getByLabelText("Inherits from"), "acme")
    await user.type(within(dialog).getByLabelText("Short name (blank inherits)"), "North")
    await user.click(within(dialog).getByRole("button", { name: "Create brand" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/brands/acme-north"))
    expect(sent).toEqual({ id: "acme-north", inheritsFrom: "acme", shortName: "North" })
  })

  it("refuses an id that is taken or malformed before saving", async () => {
    const { user } = renderApp("/settings/brands")
    await screen.findByRole("link", { name: "acme-studio" })
    await user.click(screen.getByRole("button", { name: "New brand" }))
    const dialog = await screen.findByRole("dialog", { name: "New brand" })
    await user.type(within(dialog).getByLabelText("Id"), "acme")
    await user.click(within(dialog).getByRole("button", { name: "Create brand" }))
    expect(await within(dialog).findByText("A brand with this id already exists")).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText("Id"))
    await user.type(within(dialog).getByLabelText("Id"), "Acme Two")
    await user.click(within(dialog).getByRole("button", { name: "Create brand" }))
    expect(await within(dialog).findByText('Use lowercase letters, digits, "-" or "_"')).toBeInTheDocument()
  })

  it("shows the server's field errors on the dialog's fields", async () => {
    server.use(
      http.post("*/api/brands", () =>
        HttpResponse.json(
          {
            code: "WORKSPACE_INVALID",
            message: "brands/acme-two/brand.json: legalName: must not be empty",
            details: {
              file: "brands/acme-two/brand.json",
              errors: [
                { file: "brands/acme-two/brand.json", path: "legalName", message: "must not be empty" },
                { file: "brands/acme-two/brand.json", path: "(root)", message: "something else" },
              ],
            },
          },
          { status: 400 },
        ),
      ),
    )
    const { user } = renderApp("/settings/brands")
    await user.click(await screen.findByRole("button", { name: "New brand" }))
    const dialog = await screen.findByRole("dialog", { name: "New brand" })
    await user.type(within(dialog).getByLabelText("Id"), "acme-two")
    await user.click(within(dialog).getByRole("button", { name: "Create brand" }))
    expect(await within(dialog).findByText("must not be empty")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Legal name")).toHaveAttribute("aria-invalid", "true")
    expect(within(dialog).getByText("(root): something else")).toBeInTheDocument()
  })

  it("shows BRAND_DUPLICATE (a brand created meanwhile) on the id field", async () => {
    server.use(
      http.post("*/api/brands", () =>
        HttpResponse.json({ code: "BRAND_DUPLICATE", message: 'Brand "acme-two" already exists', details: { brandId: "acme-two" } }, { status: 409 }),
      ),
    )
    const { user } = renderApp("/settings/brands")
    await screen.findByRole("link", { name: "acme-studio" })
    await user.click(screen.getByRole("button", { name: "New brand" }))
    const dialog = await screen.findByRole("dialog", { name: "New brand" })
    await user.type(within(dialog).getByLabelText("Id"), "acme-two")
    await user.type(within(dialog).getByLabelText("Legal name"), "Acme Two")
    await user.click(within(dialog).getByRole("button", { name: "Create brand" }))
    expect(await within(dialog).findByText("A brand with this id already exists")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Id")).toHaveAttribute("aria-invalid", "true")
  })
})
