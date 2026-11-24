import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The Dossier server (npm start) listens on 4400. In development Vite serves the app on 5173 and forwards API and
// file requests to it. changeOrigin stays false so the Host header is the browser's own, which keeps the server's
// same-origin check (Origin host === Host) passing for JSON and multipart writes.
const BACKEND = process.env.DOSSIER_DEV_BACKEND ?? "http://127.0.0.1:4400"
const proxied = { target: BACKEND, changeOrigin: false }

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 20 },
            { name: "ui", test: /node_modules[\\/]/, priority: 10 },
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
