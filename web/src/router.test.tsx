import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { renderApp } from "@/test/render"

// Page tests mount pages directly (renderRoute); this smoke test goes through the real route table, so a changed
// path, param name or lazy import in router.tsx shows up here. Each test loads a cold lazy page chunk, hence the
// longer wait for the heading.
const PAGES: Array<[path: string, heading: string]> = [
  ["/", "Dashboard"],
  ["/dashboard", "Dashboard"],
  ["/vault", "Vault"],
  ["/documents", "Documents"],
  ["/documents/DOC-000001", "Event services invoice"],
  ["/entities", "Entities"],
  ["/entities/1", "Acme Events Private Limited"],
  ["/generate", "Generate"],
  ["/generate/invoice", "Invoice"],
  ["/templates", "Templates"],
  ["/upload", "Upload"],
  ["/search?q=acme", "Search"],
  ["/settings/brands", "Brands"],
  ["/settings/brands/acme", "acme"],
  ["/settings/numbering", "Numbering"],
  ["/settings/workspace", "Workspace"],
]

describe("router", () => {
  it.each(PAGES)("%s renders its page", async (path, heading) => {
    renderApp(path)
    expect(await screen.findByRole("heading", { level: 1, name: heading }, { timeout: 10_000 })).toBeInTheDocument()
  })

  it("redirects /settings to the brands page", async () => {
    const { router } = renderApp("/settings")
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/brands"))
    expect(await screen.findByRole("heading", { level: 1, name: "Brands" }, { timeout: 10_000 })).toBeInTheDocument()
  })
})
