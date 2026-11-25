import { expect } from "vitest"
import { configureAxe } from "vitest-axe"

/**
 * axe-core over jsdom. Colour contrast needs real layout and painting, which jsdom does not have (axe reports it as
 * incomplete anyway), so it is off (as are iframes: previews load from the server); the dark theme's tokens were contrast-checked when they were chosen.
 */
const axe = configureAxe({ iframes: false, rules: { "color-contrast": { enabled: false } } })

/** Runs axe over `container` (default: the whole document) and fails with a readable list of any violations. */
export async function expectNoAxeViolations(container: Element = document.body) {
  const results = await axe(container)
  const report = results.violations.map(
    (v) => `${v.id} (${v.impact ?? "?"}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")}: ${n.html.slice(0, 200)}`).join("\n")}`,
  )
  expect(report, report.join("\n\n")).toEqual([])
}
