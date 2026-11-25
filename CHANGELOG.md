# Changelog

All notable changes to Dossier are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-25

The product UI release. A React web app in `web/` (Vite, TypeScript, Tailwind v4, shadcn; dark theme with one red
accent) replaces the server-rendered pages. The server serves its build (`web/dist`, made by `npm run build`) on the
same port, and the app talks to the server only through the JSON API and the file URLs. New pages cover the dashboard,
vault, documents, search, generation with live preview, upload, entities, templates and settings. New API endpoints
cover `/api/me`, `/api/meta`, `/api/dashboard` and settings. The release also adds a logo, an accessibility pass and
a Docker image. The vault, generator, numbering, MCP server and business rules are unchanged. **Breaking:** every
server-rendered HTML page and form-post route is removed (listed under Removed); use the web app or the `/api/*`
routes. See `docs/WEB.md` for the web app and `docs/BUILD_LOG.md` for how it was built.

### Added

- Web app scaffold in `web/` (npm workspace `@dossier/web`): Vite, React 19, TypeScript (strict), Tailwind v4 and
  shadcn components; dark theme with red `#e5484d` as the only accent, layered shadows and self-hosted Manrope; app
  shell with a collapsible sidebar (brand switcher, Workspace / Create / System navigation, What's new card, help link,
  user and clearance), sticky header with breadcrumbs, a navigation command palette on ⌘K / Ctrl+K, and toasts.
- The server serves the built web app from `web/dist` (`buildServer(ctx, { spaDir })`): hashed `/app/*` files are
  immutable, other files revalidate, and unmatched page paths get `index.html` with its own Content-Security-Policy
  (`SPA_CSP`); a missing build answers those paths with a one-line 503 page.
- `GET /api/me` (acting user and clearance, workspace, brands, version) and `GET /api/meta` (statuses and allowed
  transitions, enumerations, document types, folder defaults, built-in fonts, size limits).
- Typed API client (`ApiError` from the `{ code, message, details }` body, JSON and multipart with
  `X-Dossier-Client: web`), TanStack Query with mutation errors shown as toasts, money and date formatting in minor
  units and the workspace locale.
- Shared web building blocks: more shadcn components (table, tabs, chart, resizable, select, popover, calendar,
  combobox, field, checkbox, switch, toggle group, alert dialog and others), a reusable data table (TanStack Table:
  sorting, faceted filters, column visibility, pagination, with an explicit client or server mode), the dashboard API
  types, and react-hook-form, zod, date-fns and Recharts. The data table returns to the first page when a client-side
  sort, search or filter changes, and its clickable rows show a focus ring and open with Enter or Space.
- Shared confirmation dialog for destructive actions (outlined red confirm, pending state while the action runs).
- Scripts: `npm run build` (builds `web/dist`), `npm run dev:web` (Vite with a proxy to the server),
  `npm run test:web` (Vitest + Testing Library + MSW), `npm run typecheck`, and `npm run test:api` as an explicit
  name for the API and service test suite.
- Root `package.json` `homepage` and `repository` fields; the web app's help and docs links are read from them at
  build time.
- `GET /api/dashboard?days=7|30|90` (default 30): documents in the range, drafts, amount invoiced per currency (integer
  minor units; Invoice documents that are not Superseded), number conflicts, the same totals for the preceding window
  (`previous`), a zero-filled per-day timeline, the 10 most recently updated documents, series counters and warnings
  (templates that fail to load, number conflicts, missing brand asset files). Everything is limited to documents within
  the user's clearance, except the series counters, which are workspace configuration and are not filtered by
  clearance. New `listCounters(ctx)` in the numbering service and `missingBrandAssets(ws, brandId)` in the
  workspace loader.
- Dashboard page: KPI cards with change against the previous period, documents-over-time chart (weekly for 90 days),
  recent documents, series counters and workspace warnings; 7/30/90-day range kept in `?days=`.
- Vault page: resizable folder tree that loads folders from `/api/tree` as they are expanded, deep links
  `/vault/<node id>`, breadcrumb and a documents table per folder. Tree documents (web API, MCP tree resource and CLI)
  now include `type` and `docDate`.
- Documents page: server-paged table with type, status, party and date-range filters kept in the URL, column
  visibility, and correction of out-of-range pages; `GET /api/documents` now also returns `total`.
- Document page (`/documents/:id`) with PDF, HTML and Markdown preview tabs, a versions table that drives the preview,
  details, linked entities and relations in both directions; 403 and 404 shown as error states.
- Document actions: a status menu limited to the allowed transitions, with every change confirmed (Superseded as
  destructive); Regenerate, Upload new version and Download; an edit-details dialog with number-conflict warnings; add
  a link through document search; remove links with confirmation.
- Search page (`/search?q=`) with Matched, Related and Entities sections and highlighted snippets; the ⌘K palette
  shows live document and entity results (debounced `/api/search`, 8 per query), a Create group with one item per
  template, and a "Search for …" fallback. Results from an earlier query can never be opened while the next one loads.
- Generate: a template picker grouped by category with search, and a dynamic form per template (all field types, list
  rows, entity combobox, brand select defaulting to the sidebar brand) in a two-pane layout. Switching brand clears
  choices the new brand does not offer.
- Generate: live draft preview (PDF/HTML/Markdown tabs, debounced, missing and invalid fields marked on the form
  without flicker, empty-placeholder warnings), Generate with a toast and a jump to the new document, and Regenerate
  from a document's current input with the STATUS_LOCKED choice between superseding and forcing (with a version note).
- Upload page (`/upload`): drag-and-drop or choose a file, with type, title, party, party type, number and series,
  dates, amount, currency, status and a sensitivity no higher than your clearance; `?documentId=` uploads a new
  version with a note and a make-current option. Shows deduplicated files and number-conflict warnings, and refuses
  files over the upload limit as soon as they are chosen.
- Entities pages: tabs per kind, searchable table with document counts, create/edit dialog (aliases tag input, brand,
  attributes JSON), entity detail with relations, add-relation dialog with entity search, and linked documents;
  `GET /api/entities` rows include `documentCount`; `GET /api/documents` accepts `entityId` (any reference to the
  entity).
- Templates page: every template with category, type, version, numbering, renditions, sensitivity and source
  (built-in, workspace or inherited), filters, a Generate action per row, and an alert listing template folders that
  failed to load.
- Settings API for the web app: `GET /api/series/usage`, `GET /api/brands/:id/assets` (effective file per slot with
  `source`, `present`, `version` and a pinned url), `GET /api/brands/:id/file` (download as `<id>.json`),
  `GET /api/brands/:id/preview.pdf`; asset routes for the seal, watermark and large signatures.
- Settings → Brands: brand list with a New brand dialog (create-only `POST /api/brands`, 409 `BRAND_DUPLICATE` for an
  existing id), and a brand editor that saves the whole brand.json as one form: tabs per section, server field errors
  on their fields, inherited values as placeholders, per-slot asset uploads with `?v=` previews, letterhead preview and
  brand.json download.
- Settings: Numbering page (edit series rows with usage, row-level errors) and Workspace page (name, default brand,
  locale, folder hierarchy and routing, users with clearance). Lowering your own clearance asks for confirmation;
  renaming a top-level folder updates routing values that used its old name.
- Logo concepts (three directions) with brief and sources in `web/brand-src/`; the owner chose concept A, "Bound D".
- Dossier logo kit (Bound D): mark, 16 px cut, wordmark and lockups in `web/brand-src/kit`; favicon, app and PWA
  icons in `web/public/brand`, `favicon.ico` and `site.webmanifest`; the sidebar shows the new mark and wordmark.
- Responsive and accessibility pass: skip link, mobile Sheet sidebar that closes on navigation, stacked Vault panes
  and full-height form dialogs on small screens, reduced-motion support, a text alternative for the dashboard chart,
  entity-kind icons and readable relation labels in search; axe checks (vitest-axe) on the shell, every page and the
  mobile sidebar; a router smoke test over every top-level path.
- Docker: multi-stage `Dockerfile` (node:22-bookworm-slim, non-root, healthcheck), `docker-compose.yml` (loopback-only
  port, no extra capabilities) with a `./workspace` volume that is initialised from the example workspace when empty,
  `.dockerignore`, and `docs/WEB.md` (web app architecture, development, build, Docker).
- Vendored shadcn agent skill (`.claude/skills/shadcn`) for work on the web UI.
- Playwright end-to-end suite in `web/e2e/` (`npm run test:e2e`; not part of `npm test`): runs the installed Google
  Chrome at desktop (1440x900) and mobile (390x844) sizes against its own server on a temporary copy of the example
  workspace, covering the shell, navigation, tabs, generating a document, alignment and reduced motion. See
  `docs/WEB.md`.

### Changed

- The web app (`web/dist`) is served at `/` and at every client route; the former page paths now open the web app.
  Unknown page paths load the web app instead of the HTML 404 page; file paths and JSON requests still answer 404.
- Every error and unmatched route answers JSON `{ code, message, details }`, also for browsers.
- `/api` matching is case-insensitive and also catches `//api`, `/api;x` and a bare `/api`; percent-encoded file and `/api` paths never fall back to the web app. Folder URLs of the build and fonts, and wrong-case or non-canonical static paths, answer 404; `index.html` requested by name is `no-store`.
- `GET /api/meta` `hierarchy.topLevel` reports the workspace's own folder names.
- urlencoded request bodies are no longer parsed; API routes answer 415 for them.
- `npm test` runs both suites: `npm run test:api` then `npm run test:web`. The root `package.json` declares the `web`
  workspace; one lockfile covers both.
- Vendor code is split into ui, forms, table-core and dates chunks; no chunk exceeds 500 kB and charts still load only with the dashboard. The invoiced KPI shows −100% when nothing was invoiced this period.
- The MCP server reports version 1.0.0.
- Settings saves detect changes made elsewhere: `GET /api/brands/:id`, `GET /api/series` and `GET /api/workspace`
  return `fileHash` (sha256 of the stored file), and the matching PUTs accept it as an `If-Match` header, answering
  409 `CONFLICT` with `details.currentHash` when the file changed since. PUT answers and asset uploads return the new
  `fileHash`. A PUT without `If-Match` is still accepted (scripts and other HTTP clients). The brand, numbering and workspace editors
  send the hash and, on a conflict, offer to reload instead of overwriting.
- `ASSET_INVALID` for a corrupt image or font has a one-line message; the decoder's detail is in `details.reason`.
- `buildServer` takes an optional `now` clock for the dashboard's "today" (tests pin it).
- Floating navigation: the sidebar floats inset from the window edges (rounded, drop shadow, icon rail and mobile sheet
  kept) and the sticky header floats with it (blur, a shadow once content scrolls under it). The settings save bar and
  the Generate action row float the same way and stay in view.
- Motion: page changes animate the main area as short view transitions (150-250 ms, ease-out); tab panels, loaded
  pages and table rows fade in; the sidebar collapse eases and its labels fade. Everything is off under
  `prefers-reduced-motion`.
- Tabs: the document viewer's tab is kept in `?view=`; an unknown Entities `?kind=` falls back to All; long tab lists
  (brand editor sections, entity kinds, settings navigation) scroll sideways instead of wrapping; viewer and preview
  frames are not reloaded when switching tabs, and the mobile Generate Form/Preview tabs keep both panes.
- Layout: one spacing rhythm across pages (recorded in `web/CONVENTIONS.md`); toolbar controls share one height;
  numeric columns and their headers are right-aligned; long titles truncate with a tooltip; details lists use two
  columns on phones.

### Fixed

- A save in one tab no longer silently undoes changes made in another tab, by an MCP call, by an asset upload or by a
  hand edit (including a lowered clearance being restored).
- A running server re-reads `web/dist/index.html` when a rebuild changes it, instead of serving an index whose bundle
  is gone.
- Brand save, create and asset upload errors are shown once, not also as a second toast.
- Saving a brand refreshes the dashboard and cached template forms; saving an entity refreshes search results and
  the vault tree.
- The INR / `en-IN` fallback used before the workspace locale loads is defined once (`DEFAULT_LOCALE`).
- The dashboard tests no longer depend on the run not crossing midnight.
- The Generate form and preview panes on desktop scroll on their own again (the page grew instead), and the Generate
  button stays in view.
- The sidebar's resize rail no longer covers the left edge of the page; the What's new card no longer covers Settings
  items on short windows.
- The brand editor's section tabs no longer overflow onto the form; the vault's empty state is centred; phones no
  longer show a stray breadcrumb separator; a dashboard warning's "Fix" link has its space back.

### Removed

- **BREAKING:** the server-rendered UI: HTML pages, form posts, `src/web/views/*`, `src/web/html.js`, `src/web/settingsForms.js`, `src/web/public/*`, the urlencoded body parser and `PAGE_CSP` (one policy, `SPA_CSP`, covers every HTML reply). Removed routes: `GET /` (vault page), `GET /documents/:id`, `POST /documents/:id/status`, `POST /documents/:id/links`, `POST /documents/:id/links/delete`, `POST /documents/:id/metadata`, `GET /upload`, `POST /upload`, `GET /search`, `GET /templates`, `GET /generate`, `GET /generate/:id`, `POST /generate/:id`, `POST /generate/:id/preview`, `GET /entities`, `POST /entities`, `GET /entities/:id`, `POST /entities/:id`, `POST /entities/:id/relations`, `GET /settings`, `GET /settings/brands`, `POST /settings/brands`, `GET /settings/brands/:id`, `POST /settings/brands/:id`, `POST /settings/brands/:id/assets`, `GET /settings/brands/:id/brand.json` (use `GET /api/brands/:id/file`), `GET /settings/brands/:id/preview.pdf` (use `GET /api/brands/:id/preview.pdf`), `GET /settings/series`, `POST /settings/series`, `GET /settings/workspace`, `POST /settings/workspace`, `GET /static/*`.

### Security

- Entity document counts (`GET /api/entities`, `GET /api/entities/:id` and the MCP entity views) count only documents
  within the caller's clearance; they no longer reveal how many documents above it name an entity. The entity page's
  "above your clearance" note is removed.
- Upgraded `sharp` to 0.35.5 (libvips 8.18.7) for the high-severity libvips (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591; GHSA-f88m-g3jw-g9cj), libheif (GHSA-rgj7-g3m4-5g8c) and librsvg (CVE-2026-96889; GHSA-wq5f-xc86-pv6w) advisories. Generated documents are byte-identical; cached renditions are rebuilt once because the render-cache key includes the sharp version.

## [0.1.0] - 2026-11-24

First complete version: document vault, template-driven generator with 17 built-in templates, numbering series, search, server-rendered web UI, brand settings, MCP server for Claude Code, cache layers, legacy folder import, samples and visual checks, and an organisation-data guard. See `docs/BUILD_LOG.md` for how it was built.

[Unreleased]: https://github.com/zeroengineer/dossier/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zeroengineer/dossier/compare/9746d11...v1.0.0
[0.1.0]: https://github.com/zeroengineer/dossier/tree/9746d11
