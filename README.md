# Dossier

Dossier is a document vault and a template-driven document generator in one app.

- **Vault.** Every document has one ID, versions with one current, and renditions (PDF, HTML, Markdown) under that ID. Files are stored once by checksum. The folder tree is a view generated from metadata.
- **Generator.** Templates are files with a field schema, a numbering series and the renditions to produce. Preview makes an unnumbered draft; final generation assigns the number, renders all renditions, stores them and links relations.
- **MCP server.** Claude Code can search, read, preview and generate documents through tools whose business rules live in the server.

Dossier holds no organisation data in code. Names, registration ids, addresses, bank details, logos, seals, signatures, clause texts and numbering patterns all live in a **workspace** directory that you own.

> Status: under construction. See `docs/PLAN.md` for the feature list and build order.

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite`).
- Optional: `pdftoppm` (poppler) for visual diff tests.

## Setup

```sh
npm install
npm test
node bin/dossier.js init  # create ./workspace from the fake example (or: init <dir>) and load its seed entities
export DOSSIER_HOME=$PWD/workspace
node bin/dossier.js seed  # (re)load seeds/entities.json; idempotent, never overwrites your edits
```

## Running the web UI

```sh
DOSSIER_USER=demo node bin/dossier.js serve   # or: npm start
# Dossier is running at http://127.0.0.1:4400
```

`serve [--port N] [--host H]` (or `PORT` / `HOST`) starts the server for the workspace in `DOSSIER_HOME`, acting as `DOSSIER_USER` with that user's clearance. Pages: the vault tree (`/`), a document page (metadata, versions, renditions with open/download links, related entities and documents, status, link, metadata and new-version forms), upload, search, generate (a form built from the template's fields, with array rows, a draft preview in the page and generate/regenerate), templates, entities (create, edit, aliases, relations) and settings: brands (identity, registrations, contacts, bank accounts, letterhead and footer, palette, fonts, images, signatories, strings, tax modes, series map; logo/seal/signature/font uploads; a live letterhead preview PDF and a brand.json download), number series and the workspace (name, default brand, locale, users). Settings are written to the workspace files and apply without a restart (see docs/WORKSPACE.md).

The JSON API mirrors the services: `GET /api/tree`, `GET /api/documents[/:id]`, `POST /api/documents/:id/status|metadata|links`, `DELETE /api/documents/:id/links?toId=&type=`, `GET /api/documents/:id/renditions/:kind[?version=]`, `POST /api/upload` (multipart: `file` plus metadata fields or a `meta` JSON field), `GET /api/search?q=`, `GET /api/templates[/:id]`, `POST /api/templates/:id/resolve|preview|generate` (`{ input, brandId?, documentId?, force?, note? }`; preview and generate return `warnings`), `GET/POST /api/entities`, `GET /api/entities/:id`, `POST /api/entities/:id/relations`, `GET /api/brands`, `GET/PUT /api/brands/:id` (the brand's own brand.json; PUT creates or replaces it), `POST /api/brands/:id/assets/:key` (multipart `file`; key `logo`, `seal`, `watermark`, `signature:<id>`, `signature-large:<id>`, `font:<weight>`), `GET/PUT /api/series`, `GET/PUT /api/workspace`. Errors are `{ code, message, details }` with `*_NOT_FOUND` 404, `FORBIDDEN` 403, duplicates, locked or contended states 409 and validation errors 400 (a workspace edit that does not validate is `WORKSPACE_INVALID` with `details.errors: [{ file, path, message }]`).

Security: the server listens on `127.0.0.1` and only answers requests whose `Host` is a loopback name (set `HOST` to listen elsewhere; then `DOSSIER_ALLOWED_HOSTS=a.example,b.example` limits the host names). Every POST/PUT/PATCH/DELETE must come from the same origin: its `Origin` (or `Referer`) host must equal the `Host`; a request without either is accepted only with a JSON body, a non-POST method or an `X-Dossier-Client` header (scripts uploading multipart), none of which a cross-site page can send without a CORS preflight. File bytes are only served through a document the user may read (`/documents/:id/renditions/:kind`, `/blobs/:sha256/:name`), non-PDF files with `Content-Security-Policy: sandbox`. There is no login: anyone who can reach the port acts as `DOSSIER_USER`.

The example workspace uses the fake brand "Acme Events Private Limited" and neutral placeholder images. Customise it as described in `docs/WORKSPACE.md`.

PDF geometry snapshots live in `test/snapshot/__snapshots__/`; after an intended layout change, refresh them with `UPDATE_SNAPSHOTS=1 npm run test:snapshot` and review the diff.

## Vault rules

- Every document has one ID (`DOC-000001`). Each version holds up to one rendition per kind (`pdf`, `html`, `md`, `original`); exactly one version is current.
- Files are stored once by sha256 under `<DOSSIER_HOME>/data/blobs/<first two hex>/<sha256>`. Stored renditions are never changed; a stamped or corrected file is a new version.
- Status moves forward only: Draft -> Sent | Signed | Superseded, Sent -> Signed | Paid | Superseded, Signed -> Paid | Superseded, Paid -> Superseded.
- A document number repeated within its series is accepted but flagged (`numberConflict`) with an audit warning.
- Sensitivity (Public < Internal < Confidential < Restricted) is checked against the user's clearance (`users` in `workspace.json`, default Confidential) on every read, list and write.
- **Uploads are deduplicated and searchable.** Byte-identical uploads share one stored file (the response says `deduped`). Text is extracted from PDF, HTML, Markdown and plain-text uploads for search; other files are stored without text. A repeated document number in a series is accepted with a `NUMBER_CONFLICT` warning.
- **No secrets in the vault.** Uploads named `*.pem`, `*.key`, `*.env`, `.env*`, or whose bytes or extracted text contain `-----BEGIN` or `PRIVATE KEY`, are refused with `SECRET_REJECTED`. Keep keys and passwords in a password manager; a `Restricted` document may record where they live.

## Folder tree

The folder tree is generated from metadata, never stored: `node bin/dossier.js tree [node-id] [--folders] [--json]` prints it for the current user (`DOSSIER_USER`). Top level is who (`01 Company` ... `10 Restricted`), the leaf is what kind of document (from the type routing table in `src/domain/routing.js`). Clients are grouped business line -> client -> engagement (only when a client's documents span more than one engagement) -> leaf; finance documents by Indian financial year (`FY 2026-27`). Restricted documents appear only in `10 Restricted`, and only for users cleared for Restricted. Rename folders or reroute types with `hierarchy` in `workspace.json` (see `docs/WORKSPACE.md`).

## Search

`search(ctx, { q, types, status, partyId, from, to, limit, expand })` (`src/services/search.js`) looks a query up in document numbers, metadata (title, type, number, party names and aliases) and the extracted text of each document's current version. Results come in order: exact document number (or `DOC-` id) match, number prefix, metadata match, text match (text hits carry a snippet with matched words in `[` `]`). Every word of the query must match; FTS operators are treated as plain words. Entities whose name or alias contains the query are returned too, and one hop of related documents is added: documents linked to a hit by any relation (quotation, MoU, invoice, receipt, settlement…) and the documents where a matched entity is party, signatory or named. Results never include documents above the user's clearance. The index is kept up to date by every write; `node bin/dossier.js reindex` rebuilds it.

Caches: reads (entities, the folder tree, the template registry, brands, recent searches) are cached in memory and dropped on every write, including writes by another process sharing the database; rendered files are cached on disk in `data/cache/render` (`DOSSIER_RENDER_CACHE_MB`, default 500; `node bin/dossier.js cache clear` empties it). Stored files are served with an `ETag` and `private` caching (a shared proxy never keeps a gated file); see docs/PLAN.md B9.

## Generating documents

`previewDocument` and `generateDocument` (`src/services/generator.js`) turn a template and an input into documents. A preview renders every rendition with the number shown as `DRAFT` and a `DRAFT — NOT NUMBERED` watermark on each PDF page, under `data/previews/<token>/`, and writes nothing to the vault. Generating allocates the next number of the template's series, renders PDF, HTML and Markdown with it, and files one document (party, date, amount, sensitivity, issuing brand) with version 1, the `generated_from` template link, declared relations and party/signatory/issuer entities. Regenerating a Draft document adds a version with the same number; Sent, Signed or Paid documents are superseded instead (or regenerated with `force`). See `docs/TEMPLATES.md`.

Built-in templates: `invoice`, `debit-note` and `receipt` (the legacy invoice layout; tax lines from the brand's `tax.modes`, one shared counter through the brand `series` map). A debit note can name the invoice it `adjusts`; a receipt lists the invoices and debit notes it `pays`. The letter family: `offer-letter` (with the salary annexure), `internship-offer`, `internship-certificate`, `experience-certificate` and `relieving-letter` (the legacy letter layouts; certificates numbered in the `hr-cert` series, offer letters unnumbered unless the brand maps a series; clause lists and other wording replaceable per brand with `templateParams` or per document). The statements: `employee-final-settlement`, `ticketing-settlement-statement` (ticket sales, platform fee with GST, net settlement), `client-final-settlement` (numbered `FSS/{CLIENT}/{YYYY}/{###}`, `settles` invoices), `remittance-statement` (optionally `pays` documents) and `expense-statement`; amounts are computed in paise and the engagement, when given, is stored on the document. `mou` is Markdown-bodied (an organisation-wide and an event body, neutral clauses; the legacy v2 MoU layout with signature cards and an optional draft watermark) and `board-resolution` prints a certified board resolution with director lists. `proposal` (numbered in the `quotation` series, one counter per `{CODE}` (scope `brand+year+code`), the code from the engagement or client) and `pricing-report` (`report` series) draw the legacy gen-2 proposal and pricing report layouts: cover, contents with page numbers and sections given as data (`sections: [{ title, blocks, subsections? }]`, default content in the template params), with fee cards, a fixed-price card, the two-column sign-off from brand signatories and fee calculator tables (Delegate Paid / Organiser Paid, rates as params, exact paise maths). A workspace folder `templates/<id>/` without `index.js` reuses the built-in module with its own `body.md` and/or `template.json`, so private wording never needs a copy of the code. See "Built-in templates" in `docs/TEMPLATES.md`.

## MCP server (Claude Code)

`src/mcp.js` serves the vault to Claude Code over stdio: search, entities, templates, preview and generation, document status and links, plus the folder tree and documents as resources. Register it with:

```sh
claude mcp add dossier --env DOSSIER_HOME=/path/to/workspace -- node /path/to/dossier/src/mcp.js
```

It acts as `DOSSIER_USER` (default `mcp`) with that user's clearance, records its writes in the audit log as `mcp:<user>`, and picks up workspace changes (for example from the web settings) without a restart. See `docs/MCP.md` for the tool reference.

## Documentation

- `docs/PLAN.md`: architecture, data model, rules, cache layers, testing and build order.
- `docs/DISCOVERY.md`: findings from the legacy document scripts this app replaces (redacted).
- `docs/WORKSPACE.md`: creating and customising a workspace (brands, assets, series, seeds).
- `docs/TEMPLATES.md`: template folders, `template.json` fields and sources, the block model, the PDF/HTML/Markdown renderers and generation.
- `docs/MCP.md`: the MCP server: setup, tools, resources and security notes.
- `docs/DECISIONS.md`: small decisions and their reasons.

## License

Code: MIT. Bundled Manrope fonts: SIL Open Font License (`assets/fonts/Manrope/OFL.txt`).
