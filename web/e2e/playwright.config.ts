import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { defineConfig } from "@playwright/test"

// Everything the suite writes stays in web/e2e/.output (git-ignored): results, traces, the HTML report, screenshots.
const OUTPUT = path.resolve(import.meta.dirname, ".output")

// Chrome's throw-away profile (Playwright creates it under the OS temp directory) and the test workspace go into one
// mktemp-style folder made for this run, never into $HOME. The runner sets it once; its workers inherit the variables.
if (!process.env.DOSSIER_E2E_TMP) {
  const dir = mkdtempSync(path.join(tmpdir(), "dossier-e2e-"))
  process.env.DOSSIER_E2E_TMP = dir
  process.env.TMPDIR = dir
}

export const DESKTOP = { width: 1440, height: 900 }
export const MOBILE = { width: 390, height: 844 }

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  testIgnore: "**/.output/**",
  outputDir: path.join(OUTPUT, "test-results"),
  reporter: [["list"], ["html", { outputFolder: path.join(OUTPUT, "playwright-report"), open: "never" }]],
  globalSetup: "./global-setup.ts",
  // One worker: the specs share one server and workspace, and some of them write (generate, edit).
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    // The installed Google Chrome: no browser is downloaded for this suite.
    channel: "chrome",
    // Chrome also keeps a little per-user state under ~/Library (the RLZ store) whatever the profile folder is. macOS
    // resolves that folder from CFFIXED_USER_HOME when set, so the run's temporary folder stands in for the home folder.
    launchOptions: {
      env: { ...process.env, HOME: process.env.DOSSIER_E2E_TMP, CFFIXED_USER_HOME: process.env.DOSSIER_E2E_TMP },
    },
    baseURL: process.env.DOSSIER_E2E_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: DESKTOP } },
    { name: "mobile", use: { viewport: MOBILE, hasTouch: true } },
  ],
})
