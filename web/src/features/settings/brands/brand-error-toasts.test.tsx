import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { createMemoryRouter, RouterProvider } from "react-router"
import { describe, expect, it } from "vitest"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createQueryClient } from "@/lib/query-client"
import BrandSettingsPage from "@/pages/settings-brand"
import BrandsSettingsPage from "@/pages/settings-brands"
import { server } from "@/test/server"

// With the app's own query client (its MutationCache toasts every failed mutation unless `meta.silentError`), a brand
// error is reported once: by the form or dialog that shows it, not a second time by the global toast.

function renderWithAppClient(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/settings/brands", element: <BrandsSettingsPage /> },
      { path: "/settings/brands/:id", element: <BrandSettingsPage /> },
    ],
    { initialEntries: [path] },
  )
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider delayDuration={0}>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { user }
}

const toasts = () => document.querySelectorAll("[data-sonner-toast]")

describe("brand error toasts", () => {
  it("a failed brand save shows one toast", async () => {
    server.use(
      http.put("*/api/brands/:id", () =>
        HttpResponse.json(
          { code: "WORKSPACE_INVALID", message: "brands/acme/brand.json: invalid", details: { file: "brands/acme/brand.json", errors: [{ path: "(root)", message: "boom" }] } },
          { status: 400 },
        )),
    )
    const { user } = renderWithAppClient("/settings/brands/acme")
    await screen.findByRole("form", { name: "Brand acme" })
    const name = screen.getByLabelText("Short name *")
    await user.clear(name)
    await user.type(name, "Acme")
    const before = toasts().length
    await user.click(screen.getByRole("button", { name: "Save brand" }))
    expect(await screen.findByText("Not saved", { selector: "[data-sonner-toast] *" })).toBeInTheDocument()
    // Give a second (global) toast the chance to appear.
    await new Promise((r) => setTimeout(r, 300))
    expect(toasts()).toHaveLength(before + 1)
  })

  it("BRAND_DUPLICATE is shown on the id field only, without a toast", async () => {
    server.use(
      http.post("*/api/brands", () =>
        HttpResponse.json({ code: "BRAND_DUPLICATE", message: 'Brand "acme-two" already exists', details: { brandId: "acme-two" } }, { status: 409 })),
    )
    const { user } = renderWithAppClient("/settings/brands")
    await screen.findByRole("link", { name: "acme-studio" })
    await user.click(screen.getByRole("button", { name: "New brand" }))
    const dialog = await screen.findByRole("dialog", { name: "New brand" })
    await user.type(within(dialog).getByLabelText("Id"), "acme-two")
    await user.type(within(dialog).getByLabelText("Legal name"), "Acme Two")
    // Sonner's store is global: a toast left by another test may still be on screen.
    const before = toasts().length
    await user.click(within(dialog).getByRole("button", { name: "Create brand" }))
    expect(await within(dialog).findByText("A brand with this id already exists")).toBeInTheDocument()
    // Give a (global) toast the chance to appear.
    await new Promise((r) => setTimeout(r, 300))
    expect(toasts()).toHaveLength(before)
    expect(document.querySelector("[data-sonner-toast]")?.textContent ?? "").not.toMatch(/BRAND_DUPLICATE/)
  })
})
