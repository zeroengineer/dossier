import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "../..")

/** A free TCP port on the loopback address (never the default 4400). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      srv.close(() => (port && port !== 4400 ? resolve(port) : freePort().then(resolve, reject)))
    })
  })
}

async function waitFor(url: string, server: ChildProcess, ms = 30_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`The Dossier server exited early (code ${server.exitCode})`)
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`The Dossier server did not answer ${url} in time`)
}

/** A few generated documents (example clients only), so the lists, the dashboard and the viewer have content. */
async function seedDocuments(url: string) {
  const invoices = [
    { client: "Demo Retail LLP", items: [{ description: "Event production services", amount: 125000 }], taxMode: "cgst_sgst" },
    { client: "Example Institute of Sample Studies", items: [{ description: "Workshop venue and catering", amount: 48000 }], taxMode: "igst" },
    { client: "Sample Society of Placeholders", items: [{ description: "Annual meet ticketing", amount: 9900 }], taxMode: "none" },
  ]
  for (const input of invoices) {
    const res = await fetch(`${url}/api/templates/invoice/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({ input }),
    })
    if (!res.ok) throw new Error(`Seeding a document failed: ${res.status} ${await res.text()}`)
  }
}

/**
 * Starts a private Dossier server for the suite: a fresh copy of the example workspace (`dossier init`) in the run's
 * temporary folder, on a free loopback port, serving the built app (`npm run build` first). Returns the teardown.
 */
export default async function globalSetup() {
  if (!existsSync(path.join(ROOT, "web/dist/index.html"))) {
    throw new Error("web/dist is missing: run `npm run build` before `npm run test:e2e`")
  }
  const tmp = process.env.DOSSIER_E2E_TMP
  if (!tmp) throw new Error("DOSSIER_E2E_TMP is not set (playwright.config.ts creates it)")
  const home = path.join(tmp, "workspace")
  const env = { ...process.env, DOSSIER_HOME: home, DOSSIER_USER: "demo", NODE_NO_WARNINGS: "1" }
  execFileSync(process.execPath, [path.join(ROOT, "bin/dossier.js"), "init", home], { env, stdio: "ignore" })

  const port = await freePort()
  const server = spawn(process.execPath, [path.join(ROOT, "src/server.js")], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "inherit"],
  })
  const url = `http://127.0.0.1:${port}`
  await waitFor(`${url}/api/me`, server)
  process.env.DOSSIER_E2E_URL = url
  await seedDocuments(url)

  return async () => {
    if (server.exitCode === null) {
      const exited = new Promise((r) => server.once("exit", r))
      server.kill("SIGTERM")
      await exited
    }
    // The run's own temporary folder (made in playwright.config.ts): workspace copy and browser profiles.
    if (path.basename(tmp).startsWith("dossier-e2e-")) rmSync(tmp, { recursive: true, force: true })
  }
}
