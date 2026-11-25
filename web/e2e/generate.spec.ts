import { expect, test } from "@playwright/test"
import { isMobile, pageHeading, settled } from "./helpers"

test("generates an invoice from the example workspace and opens it", async ({ page }) => {
  await page.goto("/generate")
  await settled(page)
  await page.getByRole("link", { name: "Invoice", exact: true }).click()
  await expect(page).toHaveURL(/\/generate\/invoice$/)
  await settled(page)

  await page.getByPlaceholder("Pick a client").fill("Demo")
  await page.getByRole("option", { name: "Demo Retail LLP" }).click()
  const billTo = page.getByLabel("Bill to (name)")
  if (!(await billTo.inputValue())) await billTo.fill("Demo Retail LLP")
  const date = page.getByLabel("Invoice date")
  if (!(await date.inputValue())) await date.fill(new Date().toISOString().slice(0, 10))
  await page.getByLabel("Items row 1 description").fill("Stage lighting hire")
  await page.getByLabel("Items row 1 amount").fill("15000")

  if (isMobile(page)) {
    // The Form/Preview tabs keep both panes: what was typed survives a look at the preview.
    await page.getByRole("tab", { name: "Preview" }).click()
    await page.getByRole("tab", { name: "Form" }).click()
    await expect(page.getByLabel("Items row 1 description")).toHaveValue("Stage lighting hire")
  }

  // The floating action row stays in view at the bottom of the long form.
  const generate = page.getByRole("button", { name: "Generate", exact: true })
  await expect(generate).toBeInViewport()
  await generate.click()
  await expect(page).toHaveURL(/\/documents\/DOC-\d+$/, { timeout: 30_000 })
  await expect(pageHeading(page)).toContainText("Demo Retail LLP")
  await expect(page.getByRole("tablist", { name: "View" })).toBeVisible()
})
