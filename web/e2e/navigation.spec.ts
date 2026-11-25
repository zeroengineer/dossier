import { expect, test, type Page } from "@playwright/test"
import { PAGES, box, isMobile, openNav, pageHeading, settled } from "./helpers"

/** Counts `document.startViewTransition` calls, so a test can tell a page change ran as a view transition. */
async function countViewTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __viewTransitions: number; __lastViewTransition?: ViewTransition }
    w.__viewTransitions = 0
    const start = document.startViewTransition?.bind(document)
    if (!start) return
    document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
      w.__viewTransitions += 1
      const vt = start(arg)
      w.__lastViewTransition = vt
      return vt
    }) as typeof document.startViewTransition
  })
}
const transitions = (page: Page) => page.evaluate(() => (window as unknown as { __viewTransitions: number }).__viewTransitions)

/** Nothing on the page sits on top of anything else it should not: the header above the page, the sidebar beside it. */
async function expectNoOverlap(page: Page) {
  const header = await box(page.locator('[data-slot="app-header"] > div'))
  const heading = await box(pageHeading(page))
  expect(heading.y, "the page heading starts below the floating header").toBeGreaterThanOrEqual(header.y + header.height)
  if (!isMobile(page)) {
    const sidebar = await box(page.locator('[data-slot="sidebar-inner"]'))
    const main = await box(page.locator("#main-content"))
    expect(main.x, "the page starts right of the sidebar").toBeGreaterThanOrEqual(sidebar.x + sidebar.width)
    expect(header.x, "the header starts right of the sidebar").toBeGreaterThanOrEqual(sidebar.x + sidebar.width)
  }
  // The elements at a few points across the heading's row belong to the page, not to anything covering it.
  // Polled: while the view transition runs (about 200 ms), its overlay is what sits under the pointer.
  await expect.poll(() => headingCovered(page), { message: "something covers the page heading" }).toBe(false)
}

function headingCovered(page: Page) {
  return pageHeading(page).evaluate((h) => {
    const r = h.getBoundingClientRect()
    const y = r.top + r.height / 2
    return [r.left + 4, r.left + r.width / 2].some((x) => {
      const hit = document.elementFromPoint(x, y)
      return !hit || !(h === hit || h.contains(hit))
    })
  })
}

test("every top-level page opens from the sidebar with a view transition", async ({ page }) => {
  await countViewTransitions(page)
  await page.goto("/upload")
  await settled(page)
  let expected = 0
  for (const target of PAGES) {
    const nav = await openNav(page)
    const link = nav.getByRole("link", { name: target.heading, exact: true }).first()
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${target.path.replace(/\//g, "\\/")}$`))
    await settled(page)
    await expect(pageHeading(page)).toHaveText(target.heading)
    expected += 1
    expect(await transitions(page), `navigating to ${target.path}`).toBe(expected)
    // The sidebar marks the page as current.
    const current = await openNav(page)
    await expect(current.getByRole("link", { name: target.heading, exact: true }).first()).toHaveAttribute("aria-current", "page")
    if (isMobile(page)) {
      // Escape closes the sheet (pressed again if it arrived while the sheet was still opening).
      await expect(async () => {
        await page.keyboard.press("Escape")
        await expect(current).toBeHidden({ timeout: 1000 })
      }).toPass()
    }
    await expectNoOverlap(page)
  }
})

test("the page does not fade in a second time once the view transition has finished", async ({ page }) => {
  test.skip(isMobile(page), "checked at desktop size")
  await countViewTransitions(page)
  // Load each page once first: a page whose code or data arrives after the transition legitimately fades in when it
  // replaces its skeleton, which is not what this test is about.
  await page.goto("/documents")
  await settled(page)
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  for (const name of ["Entities", "Templates", "Dashboard", "Documents"]) {
    await sidebar.getByRole("link", { name, exact: true }).click()
    await settled(page)
  }
  for (const name of ["Entities", "Templates", "Dashboard"]) {
    const before = await transitions(page)
    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name, exact: true }).click()
    await expect.poll(() => transitions(page)).toBe(before + 1)
    // Sampled right after `finished` and over the following 200 ms (one content fade), when a restarted fade would run.
    const running = await page.evaluate(async () => {
      const w = window as unknown as { __lastViewTransition?: ViewTransition }
      await w.__lastViewTransition?.finished
      const samples: number[] = []
      for (let i = 0; i < 5; i++) {
        const count = [...document.querySelectorAll("#main-content > *")]
          .flatMap((el) => el.getAnimations())
          .filter((a) => a.playState === "running").length
        samples.push(count)
        await new Promise((r) => setTimeout(r, 50))
      }
      return samples
    })
    expect(running, `animations on the page root after navigating to ${name}`).toEqual([0, 0, 0, 0, 0])
    await settled(page)
  }
})

test("a query-string change on the same page is not a view transition", async ({ page }) => {
  await countViewTransitions(page)
  await page.goto("/entities")
  await settled(page)
  await page.getByRole("tab", { name: "Client" }).click()
  await expect(page).toHaveURL(/kind=client/)
  expect(await transitions(page)).toBe(0)
})

test("the Users settings item is current on its hash and scrolls to the users section", async ({ page }) => {
  await page.goto("/settings/numbering")
  await settled(page)
  const nav = page.getByRole("navigation", { name: "Settings" })
  await nav.getByRole("link", { name: "Users" }).click()
  await expect(page).toHaveURL(/\/settings\/workspace#users$/)
  await settled(page)
  await expect(nav.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page")
  await expect(nav.getByRole("link", { name: "Workspace" })).not.toHaveAttribute("aria-current", "page")
  // The section lands below the floating header, not under it.
  const header = await box(page.locator('[data-slot="app-header"] > div'))
  await expect.poll(async () => (await box(page.locator("#users"))).y).toBeGreaterThanOrEqual(header.y + header.height)
  if (!isMobile(page)) {
    const sidebar = page.getByRole("complementary", { name: "Sidebar" })
    await expect(sidebar.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page")
  }
})
