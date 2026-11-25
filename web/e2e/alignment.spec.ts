import { expect, test, type Locator, type Page } from "@playwright/test"
import { box, isMobile, settled } from "./helpers"

/**
 * Same height for every control, and the same top for controls on one line. A toolbar may wrap on phones: a control
 * that starts at least a full control height lower is on the next line, and lines up with the others there.
 */
async function expectRow(controls: Locator[], what: string) {
  const boxes = (await Promise.all(controls.map((c) => box(c)))).sort((a, b) => a.y - b.y)
  expect(boxes.length, `${what}: controls found`).toBeGreaterThan(1)
  const first = boxes[0]!
  let lineTop = first.y
  for (const [i, b] of boxes.entries()) {
    expect(Math.abs(b.height - first.height), `${what}: control ${i} height`).toBeLessThanOrEqual(1)
    if (b.y >= lineTop + first.height) lineTop = b.y
    expect(Math.abs(b.y - lineTop), `${what}: control ${i} top`).toBeLessThanOrEqual(1)
  }
}

/** Right edges of the text inside a column's header and cells (a Range over each cell's contents). */
async function columnTextRights(page: Page, table: Locator, header: string) {
  return table.evaluate((t, name) => {
    const heads = [...t.querySelectorAll("thead th")]
    const index = heads.findIndex((th) => th.textContent?.trim() === name)
    if (index < 0) throw new Error(`no column ${name}`)
    const right = (cell: Element) => {
      const range = document.createRange()
      range.selectNodeContents(cell)
      return range.getBoundingClientRect().right
    }
    const rows = [...t.querySelectorAll("tbody tr")].map((tr) => tr.children[index]).filter((c): c is Element => !!c)
    return { head: right(heads[index]!), cells: rows.map(right) }
  }, header)
}

test("documents: header actions and toolbar controls line up", async ({ page }) => {
  await page.goto("/documents")
  await settled(page)
  const main = page.locator("#main-content")
  await expectRow([main.getByRole("link", { name: "Upload" }), main.getByRole("link", { name: "Generate" })], "page actions")
  const toolbar = ["Type", "Status", "Party", "Date"].map((n) => page.getByRole("button", { name: n, exact: true }))
  await expectRow([...toolbar, page.getByRole("button", { name: "View" })], "toolbar")
})

test("documents: the Amount column is right-aligned in header and cells", async ({ page }) => {
  test.skip(isMobile(page), "the column is hidden on phones")
  await page.goto("/documents")
  await settled(page)
  const { head, cells } = await columnTextRights(page, page.getByRole("table"), "Amount")
  expect(cells.length).toBeGreaterThan(0)
  for (const right of cells) expect(Math.abs(right - head)).toBeLessThanOrEqual(1)
})

test("dashboard: the series Next column is right-aligned and the range toggle sits in one row", async ({ page }) => {
  await page.goto("/")
  await settled(page)
  const table = page.getByRole("table").filter({ hasText: "Counter" })
  const { head, cells } = await columnTextRights(page, table, "Next")
  for (const right of cells) expect(Math.abs(right - head)).toBeLessThanOrEqual(1)
  const range = ["7", "30", "90"].map((d) => page.getByRole("radio", { name: `Last ${d} days` }))
  await expectRow(range, "range toggle")
})

test("entities: search and View controls share a row", async ({ page }) => {
  await page.goto("/entities")
  await settled(page)
  await expectRow([page.getByPlaceholder("Search names and aliases…"), page.getByRole("button", { name: "View" })], "entities toolbar")
})

test("badges sit on the title's centre line in the document header", async ({ page }) => {
  await page.goto("/documents/DOC-000001")
  await settled(page)
  const title = await box(page.locator("#main-content h1"))
  const badges = page.locator('#main-content h1 ~ [data-slot="badge"]')
  for (const badge of await badges.all()) {
    const b = await box(badge)
    // On phones the badges wrap below the title; they still line up with each other.
    if (Math.abs(b.y + b.height / 2 - (title.y + title.height / 2)) > title.height) continue
    expect(Math.abs(b.y + b.height / 2 - (title.y + title.height / 2))).toBeLessThanOrEqual(2)
  }
  await expectRow(await badges.all(), "header badges")
})

test("viewer frames fill the card width", async ({ page }) => {
  await page.goto("/documents/DOC-000001")
  await settled(page)
  const card = await box(page.getByTestId("document-viewer"))
  const frame = await box(page.getByTitle(/^PDF of /))
  expect(frame.x).toBeGreaterThan(card.x)
  expect(frame.x + frame.width).toBeLessThan(card.x + card.width)
  expect(frame.width).toBeGreaterThan(card.width - 64)
})

test("empty states are centred in their panel", async ({ page }) => {
  test.skip(isMobile(page), "the vault panes stack on phones")
  await page.goto("/vault")
  await settled(page)
  const empty = page.locator('[data-slot="empty"]').first()
  const panel = await box(page.locator('[data-slot="resizable-panel"]').last())
  const e = await box(empty)
  const content = await box(empty.locator('[data-slot="empty-header"]'))
  // The empty state fills the panel (less its padding) and its content sits in the middle.
  expect(e.height).toBeGreaterThan(panel.height - 64)
  const mid = content.y + content.height / 2
  expect(Math.abs(mid - (e.y + e.height / 2))).toBeLessThanOrEqual(24)
})
