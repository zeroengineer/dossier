import { expect, test } from "@playwright/test"
import { openNav, pageHeading, settled } from "./helpers"

test.use({ contextOptions: { reducedMotion: "reduce" } })

test("with reduced motion, pages change without view transitions and nothing animates", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __viewTransitions: number }
    w.__viewTransitions = 0
    const start = document.startViewTransition?.bind(document)
    if (start) {
      document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
        w.__viewTransitions += 1
        return start(arg)
      }) as typeof document.startViewTransition
    }
  })
  await page.goto("/")
  await settled(page)
  const nav = await openNav(page)
  await nav.getByRole("link", { name: "Documents", exact: true }).click()
  await expect(pageHeading(page)).toHaveText("Documents")
  expect(await page.evaluate(() => (window as unknown as { __viewTransitions: number }).__viewTransitions)).toBe(0)

  const durations = await page.evaluate(() => {
    const seconds = (v: string) => Math.max(...v.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1)))
    const pick = (selector: string) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const s = getComputedStyle(el)
      return { transition: seconds(s.transitionDuration), animation: seconds(s.animationDuration) }
    }
    return {
      button: pick('#main-content [data-slot="button"]'),
      page: pick("#main-content > *"),
      row: pick('[data-slot="table-body"] > [data-slot="table-row"]'),
      header: pick('[data-slot="app-header"] > div'),
    }
  })
  for (const [name, d] of Object.entries(durations)) {
    expect(d, name).not.toBeNull()
    expect(d!.transition, `${name} transition`).toBeLessThan(0.001)
    expect(d!.animation, `${name} animation`).toBeLessThan(0.001)
  }
})

test("without reduced motion, transitions are short (150-250 ms)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await settled(page)
  const ms = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('[data-slot="app-header"] > div')!)
    return parseFloat(s.transitionDuration) * (s.transitionDuration.endsWith("ms") ? 1 : 1000)
  })
  expect(ms).toBeGreaterThanOrEqual(150)
  expect(ms).toBeLessThanOrEqual(250)
})
