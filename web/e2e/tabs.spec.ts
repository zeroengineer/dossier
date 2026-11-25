import { expect, test, type Locator, type Page } from "@playwright/test"
import { box, settled } from "./helpers"

const selected = (tab: Locator) => expect(tab).toHaveAttribute("aria-selected", "true")

/** The tab panel's top edge does not move when the tab changes (no layout jump under the list). */
async function panelTop(page: Page, list: Locator) {
  const id = await list.getByRole("tab", { selected: true }).getAttribute("aria-controls")
  return (await box(page.locator(`[id="${id}"]`))).y
}

test("document viewer: mouse, keyboard and ?view= restore on reload", async ({ page }) => {
  await page.goto("/documents/DOC-000001")
  await settled(page)
  const list = page.getByRole("tablist", { name: "View" })
  await selected(list.getByRole("tab", { name: "PDF" }))
  const top = await panelTop(page, list)

  await list.getByRole("tab", { name: "HTML" }).click()
  await expect(page).toHaveURL(/[?&]view=html/)
  await selected(list.getByRole("tab", { name: "HTML" }))
  expect(await panelTop(page, list)).toBe(top)

  await page.reload()
  await settled(page)
  await selected(list.getByRole("tab", { name: "HTML" }))
  await expect(page.getByTitle(/^HTML of /)).toBeVisible()

  // Keyboard (Radix: arrows move and select, Home and End jump).
  await list.getByRole("tab", { name: "HTML" }).focus()
  await page.keyboard.press("ArrowRight")
  await selected(list.getByRole("tab", { name: "Markdown" }))
  await expect(page).toHaveURL(/[?&]view=md/)
  await page.keyboard.press("Home")
  await selected(list.getByRole("tab", { name: "PDF" }))
  await expect(page).not.toHaveURL(/view=/)
  await page.keyboard.press("End")
  await selected(list.getByRole("tab", { name: "Markdown" }))
  await expect(page.getByRole("region", { name: /^Markdown of / })).toBeVisible()

  // An unknown view falls back to the first one.
  await page.goto("/documents/DOC-000001?view=nope")
  await settled(page)
  await selected(list.getByRole("tab", { name: "PDF" }))
})

test("document viewer: the active tab is clearly styled", async ({ page }) => {
  await page.goto("/documents/DOC-000001")
  await settled(page)
  const list = page.getByRole("tablist", { name: "View" })
  const style = (name: string) =>
    list.getByRole("tab", { name }).evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, color: s.color }
    })
  const active = await style("PDF")
  const idle = await style("HTML")
  expect(active.bg).not.toBe(idle.bg)
  expect(active.color).not.toBe(idle.color)
})

test("entities: kind tabs by mouse and keyboard, ?kind= restore, unknown kind falls back", async ({ page }) => {
  await page.goto("/entities")
  await settled(page)
  const list = page.getByRole("tablist", { name: "Entity kind" })
  await selected(list.getByRole("tab", { name: "All" }))
  await list.getByRole("tab", { name: "Client" }).click()
  await expect(page).toHaveURL(/kind=client/)
  await settled(page)
  await expect(page.getByRole("link", { name: "Demo Retail LLP" })).toBeVisible()
  await page.reload()
  await settled(page)
  await selected(list.getByRole("tab", { name: "Client" }))

  await list.getByRole("tab", { name: "Client" }).focus()
  await page.keyboard.press("Home")
  await selected(list.getByRole("tab", { name: "All" }))
  await expect(page).not.toHaveURL(/kind=/)
  await page.keyboard.press("End")
  const last = list.getByRole("tab").last()
  await selected(last)
  // The active tab is scrolled into view inside the list, also on phones where the list scrolls.
  await expect(last).toBeInViewport()

  await page.goto("/entities?kind=planet")
  await settled(page)
  await selected(list.getByRole("tab", { name: "All" }))
})

test("brand editor: section tabs keep unsaved edits, ?tab= restores, tab list scrolls instead of wrapping", async ({ page }) => {
  await page.goto("/settings/brands/acme")
  await settled(page)
  const list = page.getByRole("tablist", { name: "Brand sections" })
  await selected(list.getByRole("tab", { name: "Identity" }))
  // One row: every tab shares the list's top edge.
  const tops = await list.getByRole("tab").evaluateAll((tabs) => tabs.map((t) => Math.round(t.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)

  const shortName = page.getByLabel("Short name")
  await shortName.fill("Acme Events Edited")
  await list.getByRole("tab", { name: "Palette" }).click()
  await expect(page).toHaveURL(/[?&]tab=palette/)
  await list.getByRole("tab", { name: "Identity" }).click()
  await expect(shortName).toHaveValue("Acme Events Edited")
  await expect(page.getByText("You have unsaved changes.")).toBeVisible()
  await page.getByRole("button", { name: "Discard" }).click()

  await list.getByRole("tab", { name: "Identity" }).focus()
  await page.keyboard.press("ArrowRight")
  await selected(list.getByRole("tab", { name: "Registrations" }))
  await page.keyboard.press("End")
  await selected(list.getByRole("tab", { name: "Advanced" }))
  await expect(list.getByRole("tab", { name: "Advanced" })).toBeInViewport()
  await expect(page).toHaveURL(/[?&]tab=advanced/)
  await page.reload()
  await settled(page)
  await selected(list.getByRole("tab", { name: "Advanced" }))

  await page.goto("/settings/brands/acme?tab=nope")
  await settled(page)
  await selected(list.getByRole("tab", { name: "Identity" }))
})
