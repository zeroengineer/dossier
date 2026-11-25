import type * as React from "react"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AppShell } from "@/components/app-shell"
import DashboardPage from "@/pages/dashboard"
import DocumentPage from "@/pages/document"
import DocumentsPage from "@/pages/documents"
import EntitiesPage from "@/pages/entities"
import EntityPage from "@/pages/entity"
import GeneratePage from "@/pages/generate"
import SearchPage from "@/pages/search"
import BrandSettingsPage from "@/pages/settings-brand"
import BrandsSettingsPage from "@/pages/settings-brands"
import NumberingSettingsPage from "@/pages/settings-numbering"
import WorkspaceSettingsPage from "@/pages/settings-workspace"
import TemplatesPage from "@/pages/templates"
import UploadPage from "@/pages/upload"
import VaultPage from "@/pages/vault"
import { expectNoAxeViolations } from "@/test/axe"
import { renderRoute } from "@/test/render"

/** `page` inside the real app shell (sidebar, header, skip link, `<main>`) at `path`, mounted at `route`. */
function renderInShell(page: React.ReactElement, path: string, route: string) {
  const child = route === "" ? { index: true, element: page } : { path: route, element: page }
  return renderRoute(<AppShell />, path, { route: "/", children: [child], toaster: false })
}

// axe-core over the rendered DOM of the shell and the main pages, once their data has loaded.
describe("Accessibility (axe)", () => {
  it("Dashboard in the shell has no violations", async () => {
    renderInShell(<DashboardPage />, "/", "")
    await screen.findByTestId("kpi-documents")
    await screen.findByTestId("documents-chart")
    await screen.findByTestId("nav-user")
    await expectNoAxeViolations()
  })

  it("Documents has no violations", async () => {
    renderInShell(<DocumentsPage />, "/documents", "documents")
    await screen.findByRole("cell", { name: "Stage invoice" })
    await screen.findByTestId("nav-user")
    await expectNoAxeViolations()
  })

  it("Generate's template picker has no violations", async () => {
    renderInShell(<GeneratePage />, "/generate", "generate/:templateId?")
    await screen.findByRole("link", { name: "Invoice" })
    await screen.findByTestId("nav-user")
    await expectNoAxeViolations()
  })

  it("Generate's form and preview have no violations", async () => {
    renderInShell(<GeneratePage />, "/generate/invoice", "generate/:templateId?")
    await screen.findByRole("combobox", { name: "Brand" })
    await screen.findByTestId("nav-user")
    await expectNoAxeViolations()
  })

  it("Settings: Brands has no violations, nor does its New brand dialog", async () => {
    const { user } = renderInShell(<BrandsSettingsPage />, "/settings/brands", "settings/brands")
    await screen.findByRole("link", { name: "acme-studio" })
    await screen.findByTestId("nav-user")
    await expectNoAxeViolations()

    await user.click(screen.getByRole("button", { name: "New brand" }))
    const dialog = await screen.findByRole("dialog", { name: "New brand" })
    expect(within(dialog).getByRole("button", { name: /create/i })).toBeInTheDocument()
    await expectNoAxeViolations(dialog)
  })

  // The other pages, each once its main content has loaded.
  const pages: Array<[string, React.ReactElement, string, string, () => Promise<unknown>]> = [
    ["Vault", <VaultPage />, "/vault/03", "vault/*", () => screen.findByRole("navigation", { name: "Folders" })],
    ["Document", <DocumentPage />, "/documents/DOC-000001", "documents/:id", () => screen.findByTestId("document-viewer")],
    ["Entities", <EntitiesPage />, "/entities", "entities", () => screen.findByRole("link", { name: "Acme Events Private Limited" })],
    ["Entity", <EntityPage />, "/entities/1", "entities/:id", () => screen.findByRole("heading", { name: "Acme Events Private Limited" })],
    ["Templates", <TemplatesPage />, "/templates", "templates", () => screen.findByRole("link", { name: "Generate Invoice" })],
    ["Upload", <UploadPage />, "/upload", "upload", () => screen.findByRole("form", { name: "Upload a new document" })],
    ["Search", <SearchPage />, "/search?q=acme", "search", () => screen.findByRole("heading", { name: "Matched" })],
    ["Settings: Brand", <BrandSettingsPage />, "/settings/brands/acme", "settings/brands/:id", () => screen.findByRole("form", { name: /^Brand / })],
    ["Settings: Numbering", <NumberingSettingsPage />, "/settings/numbering", "settings/numbering", () => screen.findByRole("form", { name: "Numbering series" })],
    ["Settings: Workspace", <WorkspaceSettingsPage />, "/settings/workspace", "settings/workspace", () => screen.findByRole("form", { name: "Workspace settings" })],
  ]
  it.each(pages)("%s has no violations", async (_name, page, path, route, loaded) => {
    renderInShell(page, path, route)
    await loaded()
    await screen.findByTestId("nav-user")
    await expectNoAxeViolations()
  })
})
