# PLAN: Dossier

> Phase 1 vision and build plan written before implementation (phase 2, the web app, is summarised at the end and described in docs/WEB.md); the shipped behaviour is described in README.md and docs/*.md (where they differ, those win). Organisation-specific names are replaced by neutral labels; the unredacted copy lives in the private workspace (`dossier-workspace/docs/PLAN.full.md`), never committed.

## B0. Public-app principle: code is generic, everything organisation-specific is data

Dossier is built as a public, reusable app. The repository contains **no** company names, registration numbers, addresses, bank details, signatories, logos, seals, signatures, clause texts or numbering prefixes. All of that lives in a **workspace** (a directory outside the repo, or a git-ignored one inside it) that the app loads at startup:

```
<workspace>/                      DOSSIER_HOME (default ./workspace, git-ignored; or ~/.dossier/<name>)
├── workspace.json                name, default brand, clearance of the local user, locale (date/currency formats)
├── brands/<brandId>/             one per issuing entity (company, LLP, product brand, partner)
│   ├── brand.json                legal name, short name, registration ids [{label:"CIN", value}], addresses, contacts,
│   │                             bank accounts, websites, letterhead lines, footer lines, confidentiality label,
│   │                             palette (ink, body, muted, rule, fill, accent…), fonts {family, files per weight},
│   │                             logo variants, seal, signatories [{id, name, titles{short,long}, signatureAsset, email, phone}],
│   │                             watermark text, declaration/thank-you strings, tax config (GST rates, HSN defaults)
│   └── assets/                   logo*.png, seal.png, sign-<signatoryId>.png, fonts/*.ttf (anything not shipped)
├── templates/<templateId>/       user templates and overrides (same format as built-ins; override by id)
│   └── template.json, pdf.js?, body.md?
├── series.json                   numbering series: {id, pattern, scope, start, counter}
├── seeds/entities.json           optional: parties, people, clients, vendors, products, business lines
└── data/                         dossier.sqlite, blobs/, cache/ (created by the app)
```

Built-in templates are **generic** (invoice, debit note, receipt, offer letter, internship offer, certificate, relieving letter, employee settlement, ticketing settlement, client settlement, remittance, expense statement, MoU, board resolution, proposal, pricing report). Every string they print comes from `brand.json`, `template.json` parameters (labels, clause bodies, declaration text) or the input data. Layout profiles, palettes and fonts are brand-level config with shipped defaults (Manrope, the neutral `#1a1a1a` palette) so the app works out of the box with the fake example workspace.

The repo ships `workspace.example/` with a fake brand ("Acme Events Pvt Ltd", fake ids, generated placeholder logo/seal/signatures) and fake seeds; `dossier init` copies it to create a new workspace. A separate, private workspace for the user's own organisation is built in B15.

## B1. Architecture

One repo, one deployable, Node 22 ESM, same style as the existing scripts (pdfkit + sharp, `createRequire` for pdfkit).

```
dossier/
├── package.json            "type":"module"; bin: dossier (CLI), dossier-mcp
├── src/
│   ├── server.js           HTTP entry (Fastify): routes + static + web UI
│   ├── mcp.js              MCP stdio entry; same service layer, no HTTP hop
│   ├── cli.js              dossier init | brand add | import | generate | reindex | tree | cache clear
│   ├── config.js           env: DOSSIER_HOME (workspace), DOSSIER_USER, PORT, DOSSIER_RENDER_CACHE_MB; resolves brand/template/series files
│   ├── workspace/          loader + zod schemas for workspace.json, brand.json, series.json, template.json; asset resolver (brand asset → shipped placeholder fallback)
│   ├── db/                 sqlite open (WAL), migrations/*.sql, repo.js (all writes go through here; bumps versions, emits events)
│   ├── domain/             pure rules: numbering.js (pattern engine), status.js, sensitivity.js, naming.js, checksum.js, relations.js, routing.js
│   ├── services/           brands.js, entities.js, documents.js, versions.js, renditions.js, templates.js, generator.js, search.js, hierarchy.js, audit.js, importer.js
│   ├── render/
│   │   ├── pdf/            page.js (profiles from brand/template), letterhead.js, invoiceFrame.js, text.js, tables.js, signature.js, watermark.js, fonts.js, images.js (sharp prep, cached)
│   │   ├── html/           blocks→HTML, css in pt mirroring pdf metrics, @font-face from brand fonts
│   │   └── md/             blocks→Markdown; filled-source passthrough for markdown-bodied templates
│   ├── templates/<id>/     built-in generic templates: template.json + pdf.js (+ blocks.js | body.md)
│   ├── cache/              memo.js (versioned maps + data_version), renderCache.js (disk), lru.js
│   ├── web/                server-rendered pages + public/app.js, app.css; Settings → Brands editor (upload logo/seal/signatures, edit constants, palette, series)
│   └── extract/            text extraction for uploads (pdf, html, md)
├── assets/                 shipped defaults only: fonts/Manrope (OFL), placeholders/ (generated neutral logo/seal/signature PNGs)
├── workspace.example/      fake brand + seeds + example series + one example user template
├── test/                   unit/, integration/, snapshot/ (node:test), fixtures use workspace.example
├── docs/                   DISCOVERY.md, PLAN.md, DECISIONS.md, MCP.md, WORKSPACE.md (how to customise), TEMPLATES.md (authoring)
└── README.md
```

Dependencies (kept minimal): `pdfkit`, `sharp`, `fastify` + `@fastify/static` + `@fastify/multipart`, `@modelcontextprotocol/sdk`, `zod` (MCP tool schemas + template.json validation), `pdfjs-dist` legacy build (text extraction + snapshot geometry; not `pdf-parse`, which is a heavier wrapper), `pixelmatch` (dev). SQLite via `node:sqlite` (verified on the installed Node 22.23: loads unflagged, SQLite 3.53.4 with FTS5, JSON1, external-content triggers; API is `DatabaseSync`/`StatementSync`, sync only) with `better-sqlite3` as documented fallback. Run with `--no-warnings=ExperimentalWarning`; open with `journal_mode=WAL`, `busy_timeout=5000` because the HTTP server and the MCP process share the file; a `withTx(fn)` helper wraps BEGIN/COMMIT. No bundler; web UI is server-rendered HTML with a small vanilla `app.js`. `pdftoppm` 26.04 is installed at `/opt/homebrew/bin`, so visual diffs can run locally by default.

## B2. Data model (SQLite)

Entities (one table `entities` with `kind` + JSON `attrs`, plus typed views) or typed tables? → typed columns where rules depend on them, JSON for the rest:

- `brands(id, name, config_hash, loaded_at)` – registry of workspace brands (config itself stays in `brand.json`; the row lets documents reference a stable brand id and lets caches detect config changes).
- `entities(id, kind ∈ {company, group_entity, person, client, vendor, product, business_line, engagement, financial_year}, canonical_name UNIQUE(kind, canonical_name_normalised), display_name, brand_id NULL (for company/group_entity/product that issue documents), attrs JSON, created_at, updated_at)`
- `entity_aliases(entity_id, alias)` – resolves "Example Fest", "Example Fest 2026 - Sample College" to one id.
- `entity_relations(id, from_id, to_id, role ∈ {employed_by, director_of, belongs_to_business_line, engagement_of, vendor_of, product_of, group_entity_of, signatory_of, contact_of}, attrs JSON)`
- `documents(id 'DOC-000123', type, title, party_id, party_type, business_line_id, engagement_id, issuing_entity_id, doc_number UNIQUE NULLS DISTINCT (type_series, doc_number), doc_date, amount_minor INT, currency, status ∈ {Draft,Sent,Signed,Paid,Superseded}, sensitivity ∈ {Public,Internal,Confidential,Restricted}, due_date, current_version_id, template_id, template_version, number_conflict BOOL, created_by, created_at, updated_at)`
- `versions(id, document_id, version_no, is_current, note, input_json (generator input), created_by, created_at)` – UNIQUE(document_id, version_no); partial unique index on (document_id) WHERE is_current.
- `renditions(id, version_id, kind ∈ {pdf,html,md,original}, blob_sha256, filename, mime, bytes, extracted_text, page_count)`
- `blobs(sha256 PK, bytes, mime, stored_path, first_seen_at)` – content-addressed `data/blobs/ab/<sha256>`; byte-identical uploads reuse the row.
- `document_relations(from_doc, to_doc, type ∈ {based_on, pays, settles, adjusts, follows, generated_from, supersedes, rendition_of}, attrs)`; `generated_from` points to a template record; `rendition_of` is implicit via renditions table but also exposed in the API for the spec's vocabulary.
- `document_entities(document_id, entity_id, role ∈ {party, signatory, named, contact, issuer})` – "related entities with roles"; feeds one-hop search.
- `templates(id, version, path, schema_json, hash)` – registry of files under `src/templates`, versioned by content hash; bump `version` in template.json on layout change.
- `sequences(scope_key PK 'CO|2026', next INT)` – allocation in a transaction.
- `audit_log(id, at, actor, action, target_kind, target_id, before JSON, after JSON)` – every write path appends.
- `settings(key, value)` – per-workspace runtime settings (clearance, locale overrides); organisation constants live in `brand.json`, not here.
- `document_text(rendition_id, text)` – extracted text kept off the main row.
- `documents_fts` (FTS5 external-content over a `documents_search` view: title, doc_number, party names, aliases, extracted text, tags; `tokenize="porter unicode61"`); maintained by AFTER INSERT/UPDATE/DELETE triggers in the same transaction (verified working on `node:sqlite`).

## B3. Hierarchy as a view

`services/hierarchy.js` builds the tree purely from metadata:

```
01 Company/<Legal and Registration|Board and Governance|Banking and Payments|Compliance and Tax|Company Profile|Brand Assets>
02 People/<Person>/<Onboarding|Employment|Exit> ; 02 People/Team Identity Documents ; 02 People/HR Templates
03 Clients/<Business line>/<Client>/[<Engagement>]/<Proposals and Pricing|Agreements|Invoices and Receipts|Settlements and Statements|Deliverables and Correspondence>
04 Vendors/<Vendor>/<Agreements|Invoices Received>
05 Products/<Product>/<Marketing|Specifications|Pricing|Brand Assets|Design Source>
06 Finance/<FY>/<Bank Statements|Tax Returns|Ledgers and Reports>
07 Templates ; 08 References ; 09 Group Entities/<Entity> ; 10 Restricted
```

Leaf folder chosen by a `type → leaf` routing table (`domain/routing.js`, copied from the spec's "Document types" table). The engagement level appears only when the client has >1 engagement among *its documents*. Node ids are stable (`03/events/example-fest-2026/invoices`), so the UI and `GET /api/tree` can deep-link. Display file name follows `<date>_<party>_<type>_<number>_v<version>.<ext>`. Optional `dossier export` writes the tree to disk as a materialised view (symlinks or copies), never the source of truth.

## B4. Metadata per document

Exactly the brief's list: id, type, party + party type, business line, engagement, number, date, amount (+currency), status, version (+current flag), issuing entity, sensitivity, renditions, checksum (per rendition), expiry/due date, related entities with roles, related documents with relation types, generated-from template + version. Served by `GET /api/documents/:id` and MCP `get_document`.

## B5. Rules (enforced in `domain/` + `repo.js`, tested in unit tests)

1. One ID per document; PDF/HTML/MD are renditions of one version of that ID.
2. Versions: new version = new row; `set_current` flips the partial unique index atomically; superseding a document creates `supersedes` relation and sets old status `Superseded`.
3. Document numbers unique per series: DB unique index; upload/import of a repeated number is accepted only with `number_conflict=true` + audit warning + UI badge (matches historical reuse of 0131–0133).
4. Byte-identical files stored once (sha256 → `blobs`); re-upload returns the existing blob and links it.
5. Canonical names: `entities.canonical_name` unique per kind (case/space-insensitive); aliases map variants; `upsert_entity` refuses near-duplicates unless `alias_of` is given.
6. Sensitivity gates access: `DOSSIER_USER` has a clearance (Public<Internal<Confidential<Restricted); API filters; `Restricted` type documents (keys) are refused at upload with a message to use a password manager.
7. Originals never altered: `original` rendition is immutable; stamping/watermark produces a new rendition/version.
8. Audit: every repo write records actor (`DOSSIER_USER` / MCP client id), action, before/after.
9. No secrets: upload scanner rejects `.pem`, `.env`, files whose text matches key/token patterns; documented in README.

## B6. Search

`search(q, {kinds, types, status, party, from, to, expand=1})`:
1. FTS5 match on `search_index` (BM25) + prefix match on doc numbers + entity name/alias match.
2. Expansion one hop: hits on an entity → its documents (party, signatory, named); hits on a document → documents linked by any relation (quotation ↔ MoU ↔ invoice ↔ receipt ↔ settlement), labelled with the relation and distance.
3. Results ranked: direct metadata hits > text hits > related; grouped in the UI by "Matched" / "Related via …".
Extracted text comes from `extract/` on upload (pdfjs text content, html stripped, md raw) and from the block model for generated documents (no re-extraction).

## B7. Generator

Template = folder `src/templates/<id>/`:

```json
{ "id": "invoice", "version": 1, "type": "Invoice", "title": "Invoice",
  "layoutProfile": "invoice",
  "params": { "titleText": "INVOICE", "partyLabel": "BILL TO", "fromLabel": "FROM",
              "columns": ["S.NO","DESCRIPTION","HSN/SAC","AMOUNT"], "columnWidths": [35,275,80,125.28],
              "showBankDetails": true, "declaration": "brand.strings.invoiceDeclaration",
              "closingLine": "brand.strings.thankYou" },
  "fields": [
    {"name": "brand", "source": "brand", "required": true},
    {"name": "client", "source": "entity:client", "required": true},
    {"name": "billTo.name", "source": "client.canonical_name"},
    {"name": "billTo.address", "source": "client.attrs.address"},
    {"name": "items", "source": "ask", "type": "array", "item": {"description":"string","hsn":"string","amount":"money"}},
    {"name": "taxMode", "source": "ask", "enum": "brand.tax.modes", "default": "brand.tax.defaultMode"},
    {"name": "date", "source": "today"},
    {"name": "signatory", "source": "ask:brand.signatories", "default": "brand.defaultSignatory.invoice"},
    {"name": "bankAccount", "source": "brand.bankAccounts[0]"} ],
  "numbering": {"series": "ask:series", "default": "brand.series.invoice"},
  "sensitivity": "Internal", "renditions": ["pdf","html","md"],
  "relations": [{"type": "based_on", "from": "ask:quotation", "optional": true}],
  "partyType": "Client", "leaf": "Invoices and Receipts" }
```

Everything printed resolves through `brand.*` (names, ids, addresses, contacts, bank, strings, palette, fonts, assets, signatories), `params` (labels, column layout, toggles, clause bodies) or input fields. A workspace template with the same `id` overrides the built-in; a new `id` adds a type. `body.md` templates (MoU, agreement) use `{{field}}` placeholders, `{{#each}}` for clause lists and `{{brand.legalName}}` lookups; the filled source is parsed into blocks for PDF/HTML and stored verbatim as the Markdown rendition.

`pdf.js` exports `render(ctx, data)` where `ctx = {doc, profile, brand, fonts, assets, params, t}` (helpers never close over module-level margins or literal strings). Letter-class templates (letters, certificates, MoUs, proposals, settlements) also export `build(data) → blocks` (heading, paragraph with `**bold**`, bullets, table, keyValue, signature, pageBreak); the PDF, HTML and Markdown renderers all consume those blocks, so flow documents share one content source. The absolute-positioned invoice family (invoice, debit note, receipt) keeps hand-written `pdf.js` and `html.js` (CSS page in pt, same fonts) plus a minimal Markdown built from the data (header, items table, totals). HTML is documented as a "web rendition" with the same fonts and metrics, not a line-for-line facsimile, because `renderParagraph` does its own justification. Field sources: `entity:<kind>` (pick), `<entity>.<path>`, `settings.<path>`, `today`, `ask`, `computed:<fn>` (totals, amount in words). `resolve_fields(template, partial)` returns filled values + the remaining `ask` list, so the UI form and the MCP agent get the same contract.

Flow: `preview_document` → validate → render PDF to a temp blob with "DRAFT — NOT NUMBERED" watermark, no number, no DB document (returns a preview token + URL, cached by input hash). `generate_document` → one transaction: allocate number (`UPDATE sequences SET next = next + 1 … RETURNING`, protected by the unique index on numbers), create document + version 1 + renditions (pdf, html, md), store blobs, link `generated_from`, declared relations, `document_entities` (party, signatory), audit. Returns `{document_id, number, renditions:[{kind, sha256, url}]}`, never bytes. Re-generating with changed input creates version n+1 and keeps the number.

Numbering is a generic pattern engine (`domain/numbering.js`): prefixes and separators are literal text in the pattern, plus the tokens `{YYYY}`, `{YY}`, `{MM}`, `{FY}` (Indian financial year), `{BRAND}`, `{CLIENT}`, `{CODE}` and exactly one zero-padded counter `{#…}` (any other `{…}` is an error); `series.json` declares each series with `scope` (`global`, `brand`, `brand+year`, `brand+year+client`, `brand+year+code`), `start`, and `counter` (the id of the series whose counter it uses), so several patterns can share one counter (the shared invoice/debit-note/receipt counter is config, not code). Counters live in `sequences(scope_key)`; `dossier import` can seed them from legacy numbers. See docs/WORKSPACE.md and docs/TEMPLATES.md (Numbering).

Layout fidelity: `render/pdf/page.js` reads named layout profiles from the brand (margins, CP, logo height, header/footer style) with shipped defaults equal to the discovered ones (invoice 40/40/40; letter 37.5/100/39 CP10; settlement CP12; proposal 40/100/42 CP12; mou 45/50/50). Letterhead, footer, rich text, tables and signature blocks are straight ports of the originals with the constants supplied by profile + brand, so with the user's own workspace (B15) byte-geometry matches the originals.

Rendering determinism (verified with pdfkit 0.18 + fontkit 2.0.4: two renders with pinned info are byte-identical): `newDoc(profile)` in `render/pdf/page.js` pins `info.CreationDate/ModDate/Producer/Creator` (fixed epoch in test mode, version timestamp in final mode; pdfkit's `/ID` is an MD5 of info, no randomness), registers fonts in a fixed order (subset tag derives from object id), and image buffers come from a one-time sharp prep with `.png({compressionLevel: 9, adaptiveFiltering: false})`; tests set `sharp.cache(false)`. Then byte-level snapshots are possible.

Initial template set (built in order of value): invoice, debit-note, receipt, offer-letter, internship-offer, internship-certificate, experience-certificate, relieving-letter, employee-final-settlement, ticketing-settlement-statement, client-final-settlement, remittance-statement, mou-organisation, mou-event, proposal (gen-2 style), pricing-report, board-resolution, expense-statement. Later: registration-summary, feature-listing, agreement, a product-brand proposal variant, group-entity certificate.

## B8. MCP server

`bin/dossier-mcp` (stdio) via `@modelcontextprotocol/sdk`; all logging to stderr (stdout is the JSON-RPC stream); tools with zod schemas calling `services/*` directly:
`search`, `get_entity`, `upsert_entity`, `list_templates`, `get_template`, `resolve_fields`, `preview_document`, `generate_document`, `link_documents`, `update_status`, `get_document`. Business rules live in services (numbering, uniqueness, sensitivity, status transitions Draft→Sent→Signed/Paid, Superseded), so prompts cannot bypass them. Errors are structured (`code`, `message`, `hint`). Claude Code config snippet in README (`claude mcp add dossier -- node /path/dossier/src/mcp.js`). Also exposes resources `dossier://document/<id>` and `dossier://tree`.

## B9. Cache layers

Built in Task 21 (`src/cache/`). Every cache is derived data: deleting it (`dossier cache clear`, or a restart for the in-memory ones) only costs time.

| Layer | Caches | Invalidation |
|---|---|---|
| `cache/memo.js` in-memory, per context (`memoOf(ctx)`, LRU of 2000) | `getEntity` (by id or name/alias, per kind), `findEntities`, the template registry scan (`templates.js`), the hierarchy tree per clearance (`buildTree`), brand resolution (`getBrandFile`) | Each value is tagged with `repo.version(table)` of the tables it was built from (`repo.js` bumps a table on every in-process write, applied when the transaction ends): entities: `entities, entity_relations, documents, document_entities`; tree: those plus `versions, renditions` and the workspace hash; template scan: `templates` + workspace hash + a stat fingerprint of the template folders (so edited template files are seen without a restart); brand: workspace hash + the brand.json size/mtime. Every memo call also reads `PRAGMA data_version` (changes when another connection, i.e. the MCP or CLI process, commits) and `ctx.ws.configHash` (changes on a settings save or an MCP reload) and flushes everything when either moved. Bypassed inside a transaction. Callers get copies (`structuredClone`) |
| Render cache (disk `<dataDir>/cache/render/<key>.{pdf,html,md}` + `<key>.json` meta + `<base>.assets.json` manifest) | preview and final renditions (`renderWithCache` in the generator) | Base key = sha256 of template id, version and hash, canonical values and input JSON, brand id and config hash, `workspace.json` settings, number, draft flag, creation date, a hash of the shared render code (`src/render`, `src/templates`, `src/workspace`, `src/domain`, `generator.js`, `fields.js`, `paths.js`, computed once per process) and the pdfkit/fontkit/sharp versions. The manifest lists the brand assets (`brandAsset` keys: logo, seal, signatures, fonts) the render looked up (recorded with `AsyncLocalStorage`); the full key adds each one's resolved path and file sha256 (memoised by size/mtime/inode). Entries are checked against their recorded sha256 on read. LRU by atime (touched on every hit), size-bounded (`DOSSIER_RENDER_CACHE_MB`, default 500, 0 = off); `dossier cache clear`. A final generation still writes its blobs. Previews are dated midnight UTC of their day (reproducible); finals keep `creationDate` = now, which is in the key, so they hit only when generated again with the same `creationDate` option |
| Search query LRU (`search.js`, 256 per connection) | `search()` results keyed by clearance + options | Cleared on `document:changed` / `entity:changed`, when `PRAGMA data_version` moved, and when `repo.version('search_index')` or the workspace hash changed (reindex, reload). FTS itself is kept in sync in the writer's transaction |
| HTTP | `/blobs/:sha256/:name`: `ETag: "<sha256>"`, `Cache-Control: private, max-age=31536000, immutable`; `/documents/:id/renditions/:kind` (and the `/api` twin): ETag of the blob, `private, no-cache`; previews: ETag of the bytes, `private, no-cache`; brand assets (`/assets/brands/...`): ETag of the file, `public, max-age=31536000, immutable` only when `?v=` carries a prefix of the file hash (the settings page emits it), else `public, no-cache`; shipped fonts and `/static/`: `public, max-age=0` with the static plugin's ETag; everything else (API JSON, pages, redirects, errors) `no-store` | `If-None-Match` answers 304. Blobs and renditions are clearance-gated, so the access check runs before the 304 and the caching is `private` (a shared cache never serves a gated file to another user) |

## B10. Testing

- Runner: `node --test` (built in), `npm test`. Coverage via `--experimental-test-coverage`.
- Unit (`test/unit`): numbering patterns and shared counter, uniqueness/conflict flag, canonical name normalisation, sensitivity gate, status transitions, routing table (type→leaf), file naming, checksum dedupe, relation inverse rules, cache invalidation.
- Integration (`test/integration`, temp data dir): upload → dedupe → extract → search; generate preview (no number) → generate final (number, 3 renditions, relations, audit) → regenerate (version 2) → supersede; MCP tools end-to-end via the SDK's in-memory transport; HTTP routes via Fastify `inject`.
- Snapshot (`test/snapshot`): for each template, render with fixed fake data and pinned info, then (a) byte snapshot of the PDF (sha256), (b) geometry snapshot via pdfjs: list of `{text, x, y, font (subset prefix stripped), size}` rounded to 0.5 pt; (c) HTML/MD snapshots. Reference check: for invoice/offer letter/certificate/settlement/MoU, compare fixed label positions ("INVOICE", "BILL TO", "BANK DETAILS", "THANK YOU…", "TERMS OF EMPLOYMENT", footer) against the user's reference PDFs in `PDF Generator/refer` (read at test time from `DOSSIER_REFERENCE_DIR`, skipped if absent). Visual: `npm run visual` renders pages with `pdftoppm -r 72 -png` (gated on `which pdftoppm`; installed here) and diffs with `pixelmatch` against committed PNGs of fake-data output.
- Seeds and fixtures only contain fake names (e.g. "Example Fest 2026 - Sample College"), fake GSTIN/CIN-shaped strings, placeholder signature/seal PNGs.

## B11. Feature list in build order (one commit or a few each)

1. `chore: scaffold` – clone, package.json, `.gitignore` (workspace/, data/, node_modules, .env, *.pem), README, `node --test` setup, `docs/{DISCOVERY,PLAN,DECISIONS}.md`.
2. `feat(workspace)` – workspace loader + zod schemas (workspace.json, brand.json, series.json, template.json), asset resolver with placeholder fallback, `workspace.example/` with fake brand and generated placeholder assets, `dossier init`; tests.
3. `feat(db)` – sqlite open (WAL), migrations, `repo.js` with versions/events/data_version, audit log; unit tests.
4. `feat(entities)` – entity CRUD, canonical names + aliases, relations, brand link; tests.
5. `feat(vault)` – blobs (sha256 store), documents/versions/renditions, status, sensitivity gate; tests.
6. `feat(vault)` – upload route + text extraction (pdf/html/md); dedupe; number-conflict flag.
7. `feat(hierarchy)` – tree view from metadata, routing table (configurable in workspace), engagement level rule, file naming; tests.
8. `feat(search)` – FTS5 + one-hop expansion; tests.
9. `feat(numbering)` – pattern engine, series config, scoped counters, shared counters; tests.
10. `feat(render)` – pdf primitives driven by brand + profile: fonts, letterhead, footer post-pass, rich text, tables, signature, images cache, determinism; geometry snapshot harness.
11. `feat(templates)` – template registry (built-in + workspace overrides), field resolution (`resolve_fields` incl. `brand.*`, `ask:`), block model → HTML/MD renderers, `body.md` placeholder engine.
12. `feat(generator)` – preview (watermarked, unnumbered) and final generation (numbering, renditions, relations, audit, versions); integration tests.
13. `feat(templates)` – invoice, debit-note, receipt.
14. `feat(templates)` – offer-letter, internship-offer, internship-certificate, experience-certificate, relieving-letter.
15. `feat(templates)` – employee-final-settlement, ticketing-settlement-statement, client-final-settlement, remittance-statement, expense-statement.
16. `feat(templates)` – mou (organisation + event bodies), board-resolution.
17. `feat(templates)` – proposal, pricing-report.
18. `feat(web)` – server-rendered UI: tree browser, document page, upload, search, generate form (from `resolve_fields`), preview iframe, status/relations editing.
19. `feat(web)` – Settings → Brands: create/edit brand, upload logo/seal/signatures/fonts, palette, strings, signatories, series; validation and live letterhead preview.
20. `feat(mcp)` – stdio server with the 11 tools + resources; in-memory transport tests; `docs/MCP.md`.
21. `feat(cache)` – memo layer (+ data_version), render cache, query LRU, HTTP caching headers; invalidation tests.
22. `feat(import)` – `dossier import <folder> --index <csv>` bulk-registers legacy documents (sha256 dedupe, number parsing, conflict flags, counter seeding).
23. `feat(samples)` + `docs` – `npm run samples` (every template, example workspace), README (setup, run, test, customise, MCP connect), `docs/WORKSPACE.md`, `docs/TEMPLATES.md`, visual check script, wrap-up summary.

## B12. Decisions to record in `docs/DECISIONS.md` (small, chosen now)

- Code is organisation-agnostic; all organisation data, assets and strings live in a workspace (`DOSSIER_HOME`), never in `src/` or git.
- `node:sqlite` over better-sqlite3 (no native build; fallback documented).
- Fastify + server-rendered HTML, no bundler (one deployable, few deps).
- Template = folder with `template.json` + `pdf.js` (+ `blocks.js` or `body.md`); workspace templates override built-ins by id.
- Numbering = pattern engine + series config; shared counters are configuration; legacy conflicts flagged, not rejected.
- Shipped assets are only OFL fonts and generated neutral placeholders; real logos/seals/signatures are workspace files.
- Missing Figtree font: templates that used it (portfolio, society-client header) are out of initial scope.
- Dates stored ISO; display formats per brand locale with per-template overrides.
- Implementation is done by Opus 5.5 subagents, one feature per agent, verified in the main session (B16).

## B14. Customisation surface (what a public user can change without touching code)

| Area | Where | Examples |
|---|---|---|
| Issuing entities | `brands/<id>/brand.json` | legal name, registration ids (any labels), addresses, emails, phones, websites, bank accounts, tax config |
| Visual identity | `brand.json` + `brands/<id>/assets/` | logo variants, seal, per-signatory signature images, fonts (any TTF set with weight map), palette, letterhead/footer lines, confidentiality label, watermark text |
| Signatories | `brand.json.signatories` | name, short/long titles, default per document type |
| Numbering | `series.json` | patterns, scopes, starts, shared counters |
| Document types | `templates/<id>/` | new templates, overrides, labels, clause bodies (`body.md`), column layouts, toggles |
| Vault structure | `workspace.json.hierarchy` | top-level folder names/order, type→leaf routing, business lines |
| Locale | `workspace.json.locale` | currency symbol/format, date formats, amount-in-words language |
| Access | `workspace.json.users` | clearance per local user id |
| Seeds | `seeds/entities.json` | initial parties |

The web Settings pages edit all of these (writing back to the workspace files and bumping `brands.config_hash`); the CLI and MCP read the same files.

## B15. The user's private workspace – set up after the app, never committed

Location: `<current folder>/dossier-workspace/` (outside the repo, so moving `dossier/` later does not drag private data; path given via `DOSSIER_HOME`). Built by a one-off script kept in the workspace itself (`setup/from-legacy.js`), run locally:

1. `brands/<company>/brand.json` – values from A7 (legal name, CIN, GSTIN, PAN, Udyam, DPIIT, business address, emails per purpose, phones, bank, websites, signatories: director 1 "CEO & Managing Director" / "Managing Director", director 2 "Chief Operating Officer", strings: invoice declaration, thank-you line, "Confidential"); fonts Manrope (shipped); palette = discovered neutral palette; layout profiles = discovered constants.
2. `brands/<company>/assets/` – copied from the canonical files in A4: `company-logo.png` (logo), `company seal.png` → `seal.png`, `signature.png` → `sign-director2.png`, `authorised sign.png` → `sign-director1.png`, `alt sign.png` → `sign-director2-alt.png`.
3. `brands/<group-entity>/` – the group entity (an LLP) (LLPIN, website, emails, blue palette, gold accent), logo/icon/seal, signatory director 2 "Head of HR".
4. `brands/<product-A>/` and `brands/<product-B>/` as product brands (logo, emails, accent palette: brand B green) inheriting the company legal data via `inheritsFrom: "<company>"`.
5. `series.json` – `CO-{YYYY}-{####}` / `CO-DN-{YYYY}-{####}` / `CO-REC-{YYYY}-{####}` sharing one counter seeded at 0140; `COX-{CODE}-{YYYY}-{##}`; `COX-REP-{YYYY}-{###}` from 130; `COX-DOC-{YYYY}-{CODE}`; `CO/HR/{YYYY}/EXP-{###}` from 013; `FSS/{CLIENT}/{YYYY}/{###}`; `CO-QT-{YYYY}-{###}` from 024.
6. `templates/` – overrides carrying company-specific bodies: offer-letter clause set (15 clauses from A8 §2), internship terms, certificate wording, MoU bodies ported from `MD file/Organisation_MoU_Template.md`, `Event_Draft_MoU.md`, `Annual_Strategic_Partnership_MoU_Template.md` with placeholders, proposal section texts and fee-card defaults (2% + GST, gateway 2% + GST, T+7), pricing-report calculators, product brand B proposal variant.
7. `seeds/entities.json` – business lines (`Events - <product A>`, `Software and Services`), clients/engagements/people/vendors/products from A7 (names only; no personal addresses or ids).
8. `workspace.json` – hierarchy names as in the spec (01 Company … 10 Restricted), locale en-IN, `₹`, date formats.
9. Optional `dossier import "<current folder>/final" --index final/_index.csv` to register the legacy vault (dedupe, numbers, conflicts flagged) into the private workspace DB.
10. Verification against originals: with `DOSSIER_HOME` pointing at this workspace, run the geometry/visual comparison of each generated sample against `PDF Generator/refer/*.pdf`.

## B16. Implementation process

- Model: all implementation agents run on **Opus 5.5** (`Agent` tool with `model: "opus"`), one feature from B11 per agent, in a worktree-free sequential flow inside `dossier/` (features depend on each other). Each agent gets: the feature's spec section, the relevant DISCOVERY numbers, the repo conventions, and the instruction to write tests first, run `npm test`, and commit with the required message format. The main session reviews each diff and test output before the next feature starts; a quick review agent (also Opus) checks for hardcoded organisation values before every `feat(templates)` commit.
- Commits only; pushes deferred until GitHub auth exists (user decision).
- Phase 5 wrap-up: full test suite, `npm run samples` on `workspace.example` and on the private workspace, side-by-side comparison with originals, README, summary of built/skipped/next.

## B13. Verification (end to end, after build)

1. `npm test` green (unit + integration + snapshot) on `workspace.example`.
2. `npm run samples` → one PDF/HTML/MD per template with fake data; then with `DOSSIER_HOME=../dossier-workspace` (B15) regenerate and compare with `PDF Generator/refer/*.pdf` side by side; geometry test asserts fixed-label coordinates equal. A grep-based test asserts no organisation-specific strings (names, ids, bank numbers) exist under `src/`, `assets/`, `workspace.example/`.
3. `npm start` → browse tree, upload a PDF twice (second is deduped), search a fake person and see their documents + signed documents; generate an invoice preview (no number) then final (number allocated, 3 renditions, `based_on` link).
4. `claude mcp add dossier -- node src/mcp.js` → from Claude Code call `list_templates`, `resolve_fields`, `preview_document`, `generate_document`, `search`.
5. `git log` reads as the feature sequence above; pushes after each feature (needs `gh auth login` first).

## User decisions (confirmed 2026-11-23)

1. **Git push**: commit locally after every feature; skip pushes until the user runs `gh auth login` (or adds a PAT/SSH key), then push everything. Wrap-up notes that pushes are pending.
2. **Template scope**: all 18 templates in B7 in this build, in the order of B11 items 11–15.
3. **Markdown-driven types (MoUs, agreements)**: the template's source markdown (ported from `PDF Generator/MD file/*_MoU*.md` with placeholders) is the editable body; the generator fills placeholders, parses it into blocks for PDF/HTML, and the Markdown rendition is the filled source verbatim. Other types derive Markdown from blocks.

## Execution notes (for Phase 3 onward)

- Phase 3 step 1: clone the project repository into `dossier` from the current folder (HTTPS, public read works); write `docs/DISCOVERY.md` from Part A and `docs/PLAN.md` from Part B of this file, add `docs/DECISIONS.md` (B12 + the three decisions above), `.gitignore`, README, test setup; first commit `chore: scaffold project, docs and test setup`.
- Copy into `dossier/assets/` only Manrope static TTFs + `OFL.txt`. Generate neutral placeholder PNGs with sharp from SVG at the pixel dimensions the layouts expect (logo 1027x234, signature 1024x406, authorised sign 5914x4873, seal 1586x1471) so `workspace.example` renders with correct geometry. The organisation's real logos, seals and signatures go only into the private workspace (B15), never into the repo.
- Implementation agents: Opus 5.5 (`model: "opus"`), one B11 feature each (B16).
- Commit style: `feat(scope): …` with a body (what, why, how tested); attribution line from the session reminder.
- Never touch anything outside `dossier/`.

## Phase 2: product UI (1.0.0)

Everything above is the phase 1 (0.1.0) plan, kept as history. Phase 2 replaced the server-rendered web UI described in B1 (`src/web/` pages, "No bundler") with a React web app in `web/` (Vite, TypeScript, Tailwind v4, shadcn), served by the same Fastify server from `web/dist` and talking only to `/api/*` and the file URLs. The vault, generator, numbering, MCP server and every business rule stayed as planned here; the server gained `GET /api/me`, `GET /api/meta`, `GET /api/dashboard` and a few settings endpoints. Phase 2 also added a logo kit and a Docker image.

- `docs/WEB.md`: the web app's architecture, source layout, development, build and Docker.
- `CHANGELOG.md` (1.0.0): what was added, changed and removed, including every removed HTML route.
- `docs/BUILD_LOG.md` ("Phase 2: product UI"): how it was built: features, reviews, rulings and incidents.
- `docs/DECISIONS.md` ("phase 2: product UI"): the decisions and their reasons.
