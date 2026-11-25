import { expect, test } from "@playwright/test"
import { PAGES, box, isMobile, openNav, pageHeading, settled } from "./helpers"

test.describe("app shell", () => {
  test("the page never scrolls sideways", async ({ page }) => {
    for (const { path } of PAGES) {
      await page.goto(path)
      await settled(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0)
    }
  })

  test("the header floats: inset, rounded, and lifted once the page scrolls under it", async ({ page }) => {
    await page.goto("/settings/workspace")
    await settled(page)
    const bar = page.locator('[data-slot="app-header"] > div')
    const b = await box(bar)
    expect(b.y).toBeGreaterThanOrEqual(8)
    const style = await bar.evaluate((el) => {
      const s = getComputedStyle(el)
      return { radius: parseFloat(s.borderTopLeftRadius), blur: s.backdropFilter, shadow: s.boxShadow }
    })
    expect(style.radius).toBeGreaterThan(0)
    expect(style.blur).toContain("blur")
    await page.mouse.wheel(0, 600)
    await expect(page.locator('[data-slot="app-header"]')).toHaveAttribute("data-scrolled", "true")
    await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none")
    // Still at the top while scrolled.
    expect((await box(bar)).y).toBeGreaterThanOrEqual(8)
  })
})

test.describe("floating sidebar (desktop)", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "desktop only")

  test("floats inset with a drop shadow and lines up with the header and the page", async ({ page }) => {
    await page.goto("/vault")
    await settled(page)
    const inner = page.locator('[data-slot="sidebar-inner"]')
    const sb = await box(inner)
    const viewport = page.viewportSize()!
    expect(sb.x).toBe(8)
    expect(sb.y).toBe(8)
    expect(Math.round(sb.y + sb.height)).toBe(viewport.height - 8)
    const style = await inner.evaluate((el) => {
      const s = getComputedStyle(el)
      return { radius: parseFloat(s.borderTopLeftRadius), shadow: s.boxShadow }
    })
    expect(style.radius).toBeGreaterThan(0)
    expect(style.shadow).not.toBe("none")

    // The floating header's top edge is the sidebar's top edge; the page starts right of the sidebar.
    const header = await box(page.locator('[data-slot="app-header"] > div'))
    expect(header.y).toBe(sb.y)
    expect(header.x).toBeGreaterThan(sb.x + sb.width)
    const main = await box(page.locator("#main-content"))
    expect(main.x).toBeGreaterThanOrEqual(sb.x + sb.width)
    // The vault's panel fills the page down to the sidebar's bottom edge.
    const panel = await box(page.locator('[data-slot="resizable-panel-group"]').first())
    expect(Math.abs(panel.y + panel.height - (sb.y + sb.height))).toBeLessThanOrEqual(1)
  })

  test("collapses to an icon rail and expands again", async ({ page }) => {
    await page.goto("/documents")
    await settled(page)
    const inner = page.locator('[data-slot="sidebar-inner"]')
    const wide = (await box(inner)).width
    const trigger = page.locator('[data-slot="app-header"]').getByRole("button", { name: "Toggle Sidebar" })
    await trigger.click()
    await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible()
    await expect.poll(async () => (await box(inner)).width).toBeLessThan(80)
    // Labels fade out in the rail; the links stay reachable by their names.
    const label = inner.getByRole("link", { name: "Documents" }).locator("span")
    await expect.poll(() => label.evaluate((el) => getComputedStyle(el).opacity)).toBe("0")
    await expect(inner.getByRole("link", { name: "Documents" })).toHaveAttribute("data-active", "true")
    // The page follows the rail.
    const main = await box(page.locator("#main-content"))
    expect(main.x).toBeLessThan(100)

    await page.keyboard.press("ControlOrMeta+b")
    await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible()
    await expect.poll(async () => (await box(inner)).width).toBe(wide)
    await expect.poll(() => label.evaluate((el) => getComputedStyle(el).opacity)).toBe("1")
  })
})

test.describe("mobile sidebar", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, "phones only")

  test("opens as a sheet and closes after navigating", async ({ page }) => {
    await page.goto("/")
    await settled(page)
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0)
    const sheet = await openNav(page)
    await sheet.getByRole("link", { name: "Entities" }).click()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/entities$/)
    await expect(pageHeading(page)).toHaveText("Entities")
  })
})

test("the breadcrumbs show only the current page on phones and the trail on desktop", async ({ page }) => {
  await page.goto("/documents/DOC-000001")
  await settled(page)
  const crumbs = page.getByRole("navigation", { name: "breadcrumb" })
  await expect(crumbs.getByText("DOC-000001")).toBeVisible()
  if (isMobile(page)) {
    await expect(crumbs.getByRole("link", { name: "Documents" })).toBeHidden()
    await expect(crumbs.locator('[data-slot="breadcrumb-separator"]:visible')).toHaveCount(0)
  } else {
    await expect(crumbs.getByRole("link", { name: "Documents" })).toBeVisible()
  }
})
