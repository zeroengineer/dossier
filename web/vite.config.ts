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
        // Long-lived vendor chunks: React and the router, then the UI primitives, apart from the app's own code.
        // Recharts and the libraries only it uses go to `charts`, which only the dashboard's lazy chart imports.
        // `ui` is claimed before `charts` so a library both use (clsx) is not pulled into `charts` as a Recharts
        // dependency, which would make the entry load the whole chart chunk.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 20 },
            { name: "ui", test: new RegExp(`^(?!.*node_modules[\\\\/]${CHART_LIBS}[\\\\/]).*node_modules[\\\\/]`), priority: 15 },
            { name: "charts", test: new RegExp(`node_modules[\\\\/]${CHART_LIBS}[\\\\/]`), priority: 10 },
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
