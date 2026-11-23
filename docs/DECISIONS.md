# Decisions

Small decisions made while building Dossier. Each entry: decision, reason, cost if wrong.

## 2026-11-23 (planning)

- **Code is organisation-agnostic.** All organisation data, assets, strings, clause bodies and numbering patterns live in a workspace (`DOSSIER_HOME`), never in `src/` or git. Reason: Dossier is a public app. Cost if wrong: one extra indirection for single-company use.
- **Discovery is committed redacted.** `docs/DISCOVERY.md` replaces registration ids, bank details, phone numbers and salary figures with placeholders; the full copy lives in the private workspace. Reason: the brief asks for discovery in the repo, and the repo is public. Cost: readers of the repo see placeholders instead of real values.
- **`node:sqlite`** (built into Node 22.23, SQLite 3.53 with FTS5) over `better-sqlite3`. No native build. Fallback documented if the experimental API changes. Run with `--no-warnings=ExperimentalWarning`; WAL mode because the HTTP server and MCP process share the file.
- **Fastify + server-rendered HTML**, no bundler. One deployable, few dependencies; every screen is form in, HTML out.
- **Template = folder** with `template.json` + `pdf.js` (+ `blocks.js` or `body.md`). Workspace templates override built-ins by id.
- **Flow documents share one block model** (PDF, HTML, Markdown). The absolute-positioned invoice family keeps hand-written `pdf.js` and `html.js`.
- **Markdown-bodied templates (MoU, agreement):** the filled source markdown is the Markdown rendition verbatim; PDF/HTML are rendered from its parsed blocks (user decision).
- **HTML rendition is a web rendition**, same fonts and metrics, not a line-for-line facsimile of the PDF.
- **Numbering = pattern engine + series config.** Shared counters (invoice / debit note / receipt) are configuration. Legacy number conflicts are flagged, not rejected.
- **Shipped assets are only OFL fonts (Manrope) and generated neutral placeholders** at the pixel sizes the layouts expect. Real logos, seals and signatures are workspace files.
- **Figtree is missing** from the legacy folder, so portfolio and IEEE-header layouts are out of the initial scope.
- **Dates stored ISO**; display formats come from the workspace locale, with per-template overrides.
- **PDF determinism:** document info dates are pinned (fixed epoch in tests, version timestamp in production) so pdfkit output is byte-stable.
- **Text extraction with `pdfjs-dist` legacy build**, not `pdf-parse` (a heavier wrapper around an older pdfjs).
- **Work on `main` in the new repo.** The repo was empty and the brief asks for commits after each feature; no other branch exists.
- **Pushes deferred** until GitHub auth is configured on this machine (user decision). Commits are made locally after each feature.
- **Implementation by Opus 5.5 subagents**, one feature per agent, each reviewed before the next (user request).
- **MIT licence** for code (public app); Manrope stays under OFL.

## 2026-11-23 (workspace loader)

- **Brand inheritance merges raw JSON, then validates.** A child `brand.json` may be partial; errors are reported against the child file. Arrays replace, objects merge. Asset paths resolve in the child folder first, then up the parent chain. Reason: an LLP or product brand usually differs only in name, ids and logo.
- **Signatories get an optional `signatureLarge`** next to `signature`, and `brandAsset` a `signature-large:<id>` key, because the letter family draws a differently proportioned "authorised sign" image (5914×4873 placeholder) than the invoice family (1024×406). It falls back to `signature`, then to the large placeholder.
- **`series.json` `scope` defaults to `brand+year`**, the scope of every pattern containing `{YYYY}`; `counter` defaults to the series' own id.
- **`hierarchy.topLevel` must have exactly 10 names** when given, matching the ten top-level folders of the tree view.
- **Placeholder images are drawn from SVG paths only** (no `<text>`), so rendering does not depend on system fonts and the committed PNGs are reproducible.
