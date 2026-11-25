# Changelog

All notable changes to Dossier are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Generate: live draft preview (PDF/HTML/Markdown tabs, debounced, missing and invalid fields marked on the form without flicker, empty-placeholder warnings), Generate with a toast and a jump to the new document, and Regenerate from a document's current input with the STATUS_LOCKED choice between superseding and forcing (with a version note).
- Dossier logo kit (Bound D): mark, 16 px cut, wordmark and lockups in `web/brand-src/kit`; favicon, app and PWA icons in `web/public/brand`, `favicon.ico` and `site.webmanifest`; the sidebar shows the new mark and wordmark.
- Settings → Brands: brand list with a New brand dialog (create-only `POST /api/brands`, 409 `BRAND_DUPLICATE` for an existing id), and a brand editor that saves the whole brand.json as one form: tabs per section, server field errors on their fields, inherited values as placeholders, per-slot asset uploads with `?v=` previews, letterhead preview and brand.json download.
- Entities pages: tabs per kind, searchable table with document counts, create/edit dialog (aliases tag input, brand, attributes JSON), entity detail with relations, add-relation dialog with entity search, and linked documents; `GET /api/entities` rows include `documentCount`; `GET /api/documents` accepts `entityId` (any reference to the entity).
- Generate: a template picker grouped by category with search, and a dynamic form per template (all field types, list rows, entity combobox, brand select defaulting to the sidebar brand) in a two-pane layout ready for the live preview. Switching brand clears choices the new brand does not offer.
- Upload page (`/upload`): drag-and-drop or choose a file, with type, title, party, party type, number and series, dates, amount, currency, status and a sensitivity no higher than your clearance; `?documentId=` uploads a new version with a note and a make-current option. Shows deduplicated files and number-conflict warnings, and refuses files over the upload limit as soon as they are chosen.
- Search page (`/search?q=`) with Matched, Related and Entities sections and highlighted snippets; the ⌘K palette now shows live document and entity results (debounced `/api/search`, 8 per query), a Create group with one item per template, and a "Search for …" fallback. Results from an earlier query can never be opened while the next one loads.
- Document actions: a status menu limited to the allowed transitions, with every change confirmed (Superseded as destructive); Regenerate, Upload new version and Download; an edit-details dialog with number-conflict warnings; add a link through document search; remove links with confirmation.
- Dashboard page: KPI cards with change against the previous period, documents-over-time chart (weekly for 90 days), recent documents, series counters and workspace warnings; 7/30/90-day range kept in `?days=`.
- Documents page: server-paged table with type, status, party and date-range filters kept in the URL, column visibility, and correction of out-of-range pages; `GET /api/documents` now also returns `total`.
- Vault page: resizable folder tree that loads folders from `/api/tree` as they are expanded, deep links `/vault/<node id>`, breadcrumb and a documents table per folder. Tree documents (web API, MCP tree resource and CLI) now include `type` and `docDate`.
- Templates page: every template with category, type, version, numbering, renditions, sensitivity and source (built-in, workspace or inherited), filters, a Generate action per row, and an alert listing template folders that failed to load.
- Settings API for the web app: `GET /api/series/usage`, `GET /api/brands/:id/assets` (effective file per slot with `source`, `present`, `version` and a pinned url), `GET /api/brands/:id/file` (download as `<id>.json`), `GET /api/brands/:id/preview.pdf`; asset routes for the seal, watermark and large signatures.
- Web: document page (`/documents/:id`) with PDF, HTML and Markdown preview tabs, a versions table that drives the preview, details, linked entities and relations in both directions; 403 and 404 shown as error states.
- Logo concepts (three directions) with brief and sources in `web/brand-src/`; the owner chose concept A, "Bound D".
- Vendored shadcn agent skill (`.claude/skills/shadcn`) for work on the web UI.
- `npm run test:api` as an explicit name for the API and service test suite.
- The server serves the built web app from `web/dist` (`buildServer(ctx, { spaDir })`): hashed `/app/*` files are
  immutable, other files revalidate, and unmatched page paths get `index.html` with its own Content-Security-Policy
  (`SPA_CSP`); a missing build answers those paths with a one-line 503 page.
- `GET /api/me` (acting user and clearance, workspace, brands, version) and `GET /api/meta` (statuses and allowed
  transitions, enumerations, document types, folder defaults, built-in fonts, size limits).
- Web app scaffold in `web/` (npm workspace `@dossier/web`): Vite, React 19, TypeScript (strict), Tailwind v4 and
  shadcn components; dark theme with red `#e5484d` as the only accent, layered shadows and self-hosted Manrope; app
  shell with a collapsible sidebar (brand switcher, Workspace / Create / System navigation, What's new card, help link,
  user and clearance), sticky header with breadcrumbs, a navigation command palette on ⌘K / Ctrl+K, and toasts. Every
  planned route exists; pages not built yet show their header and a "being built" state.
- Typed API client (`ApiError` from the `{ code, message, details }` body, JSON and multipart with
  `X-Dossier-Client: web`), TanStack Query with mutation errors shown as toasts, money and date formatting in minor
  units and the workspace locale.
- `GET /api/dashboard?days=7|30|90` (default 30): documents in the range, drafts, amount invoiced per currency (integer
  minor units; Invoice documents that are not Superseded), number conflicts, the same totals for the preceding window
  (`previous`), a zero-filled per-day timeline, the 10 most recently updated documents, series counters and warnings
  (templates that fail to load, number conflicts, missing brand asset files). Everything is limited to documents within
  the user's clearance. New `listCounters(ctx)` in the numbering service and `missingBrandAssets(ws, brandId)` in the
  workspace loader.
- Root `package.json` `homepage` and `repository` fields; the web app's help and docs links are read from them at
  build time.
- Scripts: `npm run build` (builds `web/dist`), `npm run dev:web` (Vite with a proxy to the server),
  `npm run test:web` (Vitest + Testing Library + MSW) and `npm run typecheck`.
- Shared web building blocks for the remaining pages: more shadcn components (table, tabs, chart, resizable, select,
  popover, calendar, combobox, field, checkbox, switch, toggle group, alert dialog and others), a reusable data table
  (TanStack Table: sorting, faceted filters, column visibility, pagination, client or server side), the dashboard API
  types, and react-hook-form, zod, date-fns and Recharts.
- Shared confirmation dialog for destructive actions (outlined red confirm, pending state while the action runs).
  The data table has an explicit client or server mode, returns to the first page when a client-side sort, search or
  filter changes, and its clickable rows show a focus ring and open with Enter or Space.

### Changed

- `npm test` runs both suites: `npm run test:api` then `npm run test:web`. The root `package.json` declares the `web`
  workspace; one lockfile covers both.
- Unknown page paths outside the server-rendered pages now load the web app instead of the HTML 404 page; misses under
  `/search`, `/upload`, `/generate`, `/templates`, `/entities` and `/settings`, file paths and JSON requests still 404.

## [0.1.0] - 2026-11-24

First complete version: document vault, template-driven generator with 17 built-in templates, numbering series, search, server-rendered web UI, brand settings, MCP server for Claude Code, cache layers, legacy folder import, samples and visual checks, and an organisation-data guard. See `docs/BUILD_LOG.md` for how it was built.
