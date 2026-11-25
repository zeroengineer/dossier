# The web app

Dossier's browser UI is a React single-page app in `web/`, served by the same Fastify server that holds the JSON API,
on the same port and origin. This page describes how it is put together, how to work on it, how it is built and how
to run everything in Docker. The binding rules for feature code are in [`web/CONVENTIONS.md`](../web/CONVENTIONS.md).

## Architecture

```text
browser ──> Fastify (src/server.js, port 4400)
              ├─ /api/*                       JSON API (src/web/routes/*.js -> src/services/*)
              ├─ /assets/fonts/*, /assets/brands/*, /previews/*, /blobs/*,
              │  /documents/:id/renditions/*  files (fonts, brand assets, draft previews, stored bytes, renditions)
              ├─ /app/*                       the web app's hashed bundle (web/dist/app, cached immutable)
              └─ /, any other GET page route  web/dist/index.html (client-side routing; 503 if not built)
```

- **One server, one origin.** `src/web/spa.js` serves `web/dist`: hashed files under `/app/*` with an immutable cache,
  other files (favicon, manifest, brand images in `web/public`) revalidated, and `index.html` for every unmatched
  GET/HEAD request (`/` included) that is not under `/api` (any letter case, any number of leading slashes), not a
  file namespace, not a file name and does not ask for JSON; the raw and the percent-decoded path are both checked.
  `index.html` is never stored (`no-store`). API misses, file misses and every error are JSON
  (`{ code, message, details }`). When `web/dist` is missing the page routes answer 503 with a one-line hint and the
  server still starts. There are no server-rendered pages and no form posts.
- **No business logic in the UI.** Lifecycle, numbering, clearance and routing rules live in the backend services. The
  app reads them from `/api/meta`, `/api/me` and API errors (`{ code, message, details }`) and never re-implements
  them.
- **Security headers.** The app's HTML gets its own Content-Security-Policy (`SPA_CSP`: scripts `'self'` only, inline
  styles allowed for Radix and Recharts). Writes are same-origin: JSON bodies pass the server's CSRF check, and
  multipart uploads add `X-Dossier-Client: web` (`web/src/lib/api.ts`). The Host check (`DOSSIER_ALLOWED_HOSTS`) applies
  to the app like every other route.
- **Stack.** TypeScript (strict, `noUncheckedIndexedAccess`), React 19, Vite (rolldown), Tailwind v4 with shadcn
  components (dark only, red `--primary` accent, Manrope from `/assets/fonts/`), TanStack Query v5 for server state,
  React Router v7, react-hook-form + zod v4, TanStack Table v8, Recharts through the shadcn chart, Lucide, Sonner.
- **Packaging.** npm workspaces: the root `package.json` lists `web` (`@dossier/web`, private). Every frontend package
  is a devDependency of `web` because it is bundled, so `npm ci --omit=dev` installs only the server's runtime
  dependencies. One lockfile at the root.

### Source layout

```text
web/
  index.html, vite.config.ts, vitest.config.ts, components.json, tsconfig*.json
  public/                 favicon.ico, site.webmanifest, brand/ (copied into web/dist as is)
  brand-src/              logo sources (renders are git-ignored)
  src/
    main.tsx, app.tsx     entry, providers (QueryClient, router, toasts)
    router.tsx            routes; every page is lazy-loaded from pages/
    pages/                one file per route (dashboard, vault, documents, document, entities, entity, generate,
                          templates, upload, search, settings-*)
    features/<area>/      components, hooks and helpers of one area
    api/                  fetchers + TanStack Query hooks per area; types.ts mirrors the backend shapes
    components/           app shell, sidebar, command palette, shared components; ui/ holds the shadcn components
    lib/                  request helper (api.ts), query keys, formatting, navigation
    styles/globals.css    Tailwind and the theme tokens
    test/                 Vitest setup, MSW server and handlers, fixtures (example workspace data only)
```

## Development

Requirements: Node.js 22.13 or newer. From the repository root:

```sh
npm ci                                   # installs root and web dependencies (one lockfile)
export DOSSIER_HOME=$PWD/workspace       # a workspace made with `node bin/dossier.js init ./workspace`
export DOSSIER_USER=demo
npm start                                # terminal 1: API and file server on http://127.0.0.1:4400
npm run dev:web                          # terminal 2: Vite on http://127.0.0.1:5173 with hot reload
```

Open http://127.0.0.1:5173. Vite proxies `/api/`, `/assets/`, `/previews/`, `/blobs/`, `/app/` and
`/documents/:id/renditions/` to the server (`DOSSIER_DEV_BACKEND` changes the target, default
`http://127.0.0.1:4400`) with `changeOrigin: false`, so the browser's `Host` header reaches the server unchanged and
its same-origin check passes. The server needs no restart for frontend changes.

Checks (all must pass before a commit):

```sh
npm test                    # node --test for the API (npm run test:api) and Vitest for the web app (npm run test:web)
npm run typecheck           # tsc for web/
npm run build               # builds web/dist
node scripts/org-data-guard.js
```

Frontend tests use Vitest, Testing Library and MSW (`web/src/test/handlers/<area>.ts`); there are no browser
end-to-end tests.

## Build

`npm run build` runs `tsc -b && vite build` in `web/` and writes `web/dist/index.html` plus the hashed bundle under
`web/dist/app/` (Vite `build.assetsDir = 'app'`, so it never collides with the backend's `/assets/*`). Vendor code is
split into long-lived `react`, `ui` and `charts` chunks; the chart chunk loads only with the dashboard's charts.
`npm start` then serves the build; rebuild after frontend changes (a running server picks up a new `index.html` only
after a restart).

## Docker

The repository ships a multi-stage `Dockerfile`, a `docker-compose.yml` and a `.dockerignore`.

```sh
docker compose up --build        # then open http://localhost:4400
```

- **Image.** Both stages use `node:22-bookworm-slim` (Debian, glibc: sharp's prebuilt binaries need glibc, so no
  Alpine). The build stage runs `npm ci` and `npm run build`; the runtime stage runs `npm ci --omit=dev` and copies
  `src/`, `bin/`, `assets/`, `workspace.example/` and the built `web/dist`. The server runs as the unprivileged `node`
  user (uid 1000) with `HOST=0.0.0.0`, `PORT=4400` and `DOSSIER_HOME=/workspace`. `.dockerignore` keeps
  `node_modules`, `.git`, `.claude`, `.superpowers`, `web/dist`, workspaces, tests, docs and secrets out of the build
  context.
- **Allowed hosts.** Because the container listens on `0.0.0.0`, the server refuses to start without
  `DOSSIER_ALLOWED_HOSTS` (`HOST_UNSAFE`). Compose sets it to `localhost` (which also accepts `127.0.0.1` and `[::1]`)
  and publishes the port on the host's loopback address only (`127.0.0.1:4400`), because the vault has no login. To
  serve other machines, put an authenticating reverse proxy in front, list the names it serves in
  `DOSSIER_ALLOWED_HOSTS` and change the port binding.
- **Workspace volume.** `./workspace` on the host is mounted at `/workspace`. On the first start an empty folder is
  filled from the shipped example workspace and its seed entities are loaded (the same as `dossier init`); a folder
  that already holds a workspace is used as it is and never overwritten, and a non-empty folder without
  `workspace.json` is left alone (the server then reports the missing file). `DOSSIER_AUTO_INIT=0` turns the
  first-run copy off. To use an existing workspace, point the volume at it: `DOSSIER_WORKSPACE=/path/to/workspace
  docker compose up`. The database, render cache and previews live in `<workspace>/data`.
- **Permissions (Linux).** The container writes as uid 1000. Create the folder before the first start
  (`mkdir -p workspace`; otherwise Docker creates it owned by root) and make sure uid 1000 can write to it, or run the
  service as your own user with `user: "<uid>:<gid>"` in a compose override. Docker Desktop on macOS and Windows maps
  ownership for you.
- **Settings.** Compose reads `DOSSIER_PORT` (host port, default 4400), `DOSSIER_WORKSPACE` (host folder, default
  `./workspace`), `DOSSIER_ALLOWED_HOSTS` (default `localhost`) and `DOSSIER_USER` (default `demo`, the example
  workspace's user; use a user listed in your `workspace.json` `users`).
- **Commands.** The image puts `dossier` and `dossier-mcp` on the `PATH`, so CLI commands run against the same volume:
  `docker compose run --rm dossier dossier seed`, `docker compose run --rm dossier dossier reindex`. An explicit
  `docker compose run --rm dossier dossier init` works on an empty folder (the entrypoint skips its own copy then).
- **Health.** A `HEALTHCHECK` calls `/api/me` inside the container with Node's `fetch` (no extra packages); any answer
  below 500 counts as healthy.
