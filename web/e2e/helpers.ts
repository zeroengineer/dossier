import path from "node:path"
import { expect, type Locator, type Page } from "@playwright/test"

export const SCREENS = path.resolve(import.meta.dirname, ".output/screens")

/** Every top-level page of the app (sidebar targets plus the routes behind them). */
export const PAGES = [
  { name: "dashboard", path: "/", heading: "Dashboard" },
  { name: "vault", path: "/vault", heading: "Vault" },
  { name: "documents", path: "/documents", heading: "Documents" },
  { name: "entities", path: "/entities", heading: "Entities" },
  { name: "generate", path: "/generate", heading: "Generate" },
  { name: "templates", path: "/templates", heading: "Templates" },
  { name: "upload", path: "/upload", heading: "Upload" },
  { name: "settings-brands", path: "/settings/brands", heading: "Brands" },
  { name: "settings-numbering", path: "/settings/numbering", heading: "Numbering" },
  { name: "settings-workspace", path: "/settings/workspace", heading: "Workspace" },
] as const

/** Detail pages worth a screenshot too. */
export const DETAIL_PAGES = [
  { name: "document", path: "/documents/DOC-000001" },
  { name: "entity", path: "/entities/6" },
  { name: "generate-invoice", path: "/generate/invoice" },
  { name: "settings-brand", path: "/settings/brands/acme" },
  { name: "search", path: "/search?q=invoice" },
] as const

/** Waits until the route's code and first queries have loaded: no loading placeholders left. */
export async function settled(page: Page) {
  await page.waitForLoadState("networkidle")
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
}

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 768

/** The main heading of the routed page. */
export const pageHeading = (page: Page) => page.locator("#main-content h1").first()

/** Opens the sidebar: the Sheet on phones; on desktop the sidebar is already there. */
export async function openNav(page: Page) {
  if (!isMobile(page)) return page.getByRole("complementary", { name: "Sidebar" })
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click()
  const sheet = page.getByRole("dialog", { name: "Sidebar" })
  await expect(sheet).toBeVisible()
  return sheet as Locator
}

export async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error(`No bounding box for ${locator.toString()}`)
  return b
}
