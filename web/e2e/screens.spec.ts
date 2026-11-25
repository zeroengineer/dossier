import path from "node:path"
import { test } from "@playwright/test"
import { DETAIL_PAGES, PAGES, SCREENS, settled } from "./helpers"

// Full-page screenshots of every page at the project's viewport, for looking at the layout by eye. They go to
// web/e2e/.output/screens/<SCREENS_TAG or "latest">/ and are never committed.
const TAG = process.env.SCREENS_TAG ?? "latest"

for (const { name, path: route } of [...PAGES, ...DETAIL_PAGES]) {
  test(`screenshot ${name}`, async ({ page }, info) => {
    await page.goto(route)
    await settled(page)
    // Let entrance fades finish so the picture shows the resting state.
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SCREENS, TAG, `${info.project.name}-${name}.png`), fullPage: true })
  })
}
