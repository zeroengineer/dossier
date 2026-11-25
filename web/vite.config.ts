import { readFileSync } from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The Dossier server (npm start) listens on 4400. In development Vite serves the app on 5173 and forwards API and
// file requests to it. changeOrigin stays false so the Host header is the browser's own, which keeps the server's
// same-origin check (Origin host === Host) passing for JSON and multipart writes.
const BACKEND = process.env.DOSSIER_DEV_BACKEND ?? "http://127.0.0.1:4400"
const proxied = { target: BACKEND, changeOrigin: false }

// Project links come from the root package.json (`homepage`, `repository`), so a fork changes them in one place.
const rootPackage = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")) as {
  homepage?: string
  repository?: string | { url?: string }
}
const repoUrl = (typeof rootPackage.repository === "string" ? rootPackage.repository : rootPackage.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "")
// Recharts and the packages only it depends on (regex source). reselect is left out: Base UI uses it too, and
// Recharts' own copy is nested under recharts/node_modules.
const CHART_LIBS =
  "(recharts|victory-vendor|d3-[^\\\\/]+|internmap|@reduxjs[\\\\/]toolkit|react-redux|redux|redux-thunk|immer|decimal\\.js-light|es-toolkit|eventemitter3|tiny-invariant)"
// Libraries only some pages use, each its own vendor chunk (regex sources): forms (react-hook-form, zod, Base UI's
// combobox), the table engine and the date libraries (calendar, date-range filter).
const FORM_LIBS = "(react-hook-form|@hookform[\\\\/]resolvers|zod|@base-ui[\\\\/]react)"
const TABLE_LIBS = "(@tanstack[\\\\/]react-table|@tanstack[\\\\/]table-core)"
const DATE_LIBS = "(date-fns|@date-fns[\\\\/]tz|react-day-picker)"
const lib = (names: string) => new RegExp(`node_modules[\\\\/]${names}[\\\\/]`)
const notIn = (...names: string[]) => names.map((n) => `(?!.*node_modules[\\\\/]${n}[\\\\/])`).join("")

const links = {
  homepage: rootPackage.homepage ?? repoUrl,
  docs: repoUrl ? `${repoUrl}/tree/main/docs` : (rootPackage.homepage ?? ""),
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __DOSSIER_LINKS__: JSON.stringify(links),
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: "dist",
    assetsDir: "app",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: React and the router; the UI primitives the shell needs (`ui`); then `forms`,
        // `table-core` and `dates`, which only the pages using them load, so no chunk passes the 500 kB warning.
        // Recharts and the libraries only it uses go to `charts`, which only the dashboard's lazy chart imports.
        // A group also takes the dependencies of what it matches, so `ui` is claimed first: libraries shared with
        // the later groups (Floating UI, reselect, clsx) then stay in `ui` instead of making the entry load
        // `forms` or `charts` for them.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 20 },
            {
              name: "ui",
              test: new RegExp(`^${notIn(CHART_LIBS, FORM_LIBS, TABLE_LIBS, DATE_LIBS)}.*node_modules[\\\\/]`),
              priority: 15,
            },
            { name: "forms", test: lib(FORM_LIBS), priority: 12 },
            { name: "table-core", test: lib(TABLE_LIBS), priority: 12 },
            { name: "dates", test: lib(DATE_LIBS), priority: 12 },
            { name: "charts", test: lib(CHART_LIBS), priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "^/(api|assets|previews|blobs|app)/": proxied,
      "^/documents/[^/]+/renditions/": proxied,
    },
  },
})
