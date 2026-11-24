# Changelog

All notable changes to Dossier are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
- Root `package.json` `homepage` and `repository` fields; the web app's help and docs links are read from them at
  build time.
- Scripts: `npm run build` (builds `web/dist`), `npm run dev:web` (Vite with a proxy to the server),
  `npm run test:web` (Vitest + Testing Library + MSW) and `npm run typecheck`.

### Changed

- `npm test` runs both suites: `npm run test:api` then `npm run test:web`. The root `package.json` declares the `web`
  workspace; one lockfile covers both.
- Unknown page paths outside the server-rendered pages now load the web app instead of the HTML 404 page; misses under
  `/search`, `/upload`, `/generate`, `/templates`, `/entities` and `/settings`, file paths and JSON requests still 404.

## [0.1.0] - 2026-11-24

First complete version: document vault, template-driven generator with 17 built-in templates, numbering series, search, server-rendered web UI, brand settings, MCP server for Claude Code, cache layers, legacy folder import, samples and visual checks, and an organisation-data guard. See `docs/BUILD_LOG.md` for how it was built.
