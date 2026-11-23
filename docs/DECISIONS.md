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

## 2026-11-23 (database)

- **Entity ids are integers; document ids are text `DOC-000001`** from the `sequences` row `doc-id` (6-digit zero padding, more digits after 999999). Reason: entities are internal rows, document ids are user-facing and stable.
- **`documents` carries both `issuing_brand_id` (workspace brand) and `issuing_entity_id` (entity row).** The brand drives rendering; the entity drives the hierarchy and search.
- **`document_relations.to_doc` has no foreign key** because `generated_from` points at a template (`template:<id>@<version>`, enforced by a CHECK). Triggers give document targets the same protection as a foreign key and delete incoming relations when a document is deleted.
- **One rendition per kind per version** (`UNIQUE(version_id, kind)`); a stamped or watermarked file is a new version (rule B5.7).
- **Money needs a currency and must be an integer** (`CHECK`), party needs a party type, new documents default to `Draft` / `Internal`.
- **Extracted text lives only in `document_text`**, not on `renditions`; the FTS5 index (`documents_fts`) arrives with search in a later migration.
- **Nested transactions join the outer one** (no savepoints): an error anywhere rolls back the whole unit. Transaction callbacks must be synchronous. Errors thrown by post-commit listeners never reach the writer (the write is committed): they are emitted as `listenerError` on `repo.events`, or logged to stderr when nobody listens. The wrapper tracks its own transaction and closed state rather than relying on newer `node:sqlite` properties. Post-commit events wait for the outermost commit even when it was opened with `db.withTx` directly; per-table write versions are bumped when the transaction ends, on rollback too, so a memo built from uncommitted rows is never trusted.
- **One name normalisation: `normaliseName(name)`** (`src/domain/canonical.js`, re-exported by `src/services/entities.js`; `canonicalKey` is the same function): NFKC, lower case, curly quotes and dash variants unified to `'`/`"`/`-`, punctuation other than `&`, `'`, `-` replaced by a space, whitespace collapsed. Used for `entities.canonical_key`, `entity_aliases.alias_key`, lookups and seed validation. Names and aliases must keep at least one letter or digit.
- **Entity names are unique per kind across names and aliases.** `upsertEntity` without an id updates the entity whose canonical key matches (keeping its display name); a name or alias owned by another entity of the same kind is `ENTITY_DUPLICATE` with `existingId`, unless `aliasOf` names that entity. Renaming by id keeps the old name as an alias. Aliases are only ever added; `attrs` are shallow-merged with `null` deleting a key. Unchanged upserts write no audit row and emit no event.
- **`entity:changed` payload is `{ ids: number[] }`** (one id for entity writes, both ends for relation writes).
- **Seeding never overwrites** existing entities' names, attrs or brand; it only adds missing entities, aliases and relations, so it is safe to run repeatedly.
- **Service errors are `DossierError(code, message, details)`** (`src/errors.js`) with UPPER_SNAKE codes: `INVALID_INPUT`, `ENTITY_NOT_FOUND`, `ENTITY_AMBIGUOUS` (a name matching several kinds; `details.candidates`), `ENTITY_DUPLICATE` (`details.existingId`).
- **Brand rows are synced on every `openContext`**, written and audited only when the legal name or config hash changed; rows of removed brands are kept for the documents that reference them.

## 2026-11-23 (vault core)

- **Blob files are written before the database row** (temp file + rename, skipped when the file exists). A rolled-back transaction can leave an unreferenced blob file; it is harmless because files are content-addressed and reused by the next identical upload. A missing file for an existing row is rewritten on the next upload of the same bytes.
- **Originals are immutable by API shape:** no exported function updates or deletes a rendition; a stamped file is a new version. No database trigger was added (the services are the only writers).
- **Status may be set freely at creation** (imports of historical documents can start as Paid); after that only the transition table applies. Setting the current status again is a no-op. `updateMetadata` refuses `status`.
- **Users cannot create or move a document above their own clearance** (`FORBIDDEN`), so nobody files what they cannot read. `getDocument` of a document above clearance is `FORBIDDEN` (not `DOCUMENT_NOT_FOUND`); related documents above clearance are left out of `relations`.
- **`partyType` is inferred from the party entity's kind** (company -> Company, group_entity -> GroupEntity, person, client, vendor, product) when not given; changing the party without a type re-infers it. The party column is not copied into `document_entities`; `entities` holds the extra roles only.
- **The secret scanner applies to every upload**, not just Restricted documents: extensions `.pem`, `.key`, `.env`, file names `.env` / `.env.*`, and the markers `-----BEGIN` / `PRIVATE KEY` in the bytes or extracted text (`SECRET_REJECTED`, nothing stored).
- **A version needs at least one rendition**; one per kind. Default MIME types per kind when none is given. Number conflicts are re-evaluated when `updateMetadata` changes the series or number; flags on other documents are left as they are.
- **Display file names** drop empty segments and slug each segment: accents stripped, spaces removed, `/ \ _ : |` become `-`, other non-letter/digit characters dropped. The `original` rendition keeps its own file extension.
- **Error codes added:** `DOCUMENT_NOT_FOUND`, `VERSION_NOT_FOUND`, `BLOB_NOT_FOUND`, `BRAND_NOT_FOUND`, `FORBIDDEN`, `INVALID_STATUS_TRANSITION`, `SECRET_REJECTED`. Event `document:changed` carries `{ ids: string[] }`.
