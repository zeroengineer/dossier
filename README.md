# Dossier

Dossier is a local document vault and a template-driven document generator in one app, with an MCP server so Claude
Code can work with it.

- **Vault.** Every document has one ID (`DOC-000001`), versions with exactly one current, and renditions (PDF, HTML,
  Markdown, the original upload) under that ID. Files are stored once by checksum. The folder tree is a view computed
  from metadata, never stored.
- **Generator.** A template is a folder with a field schema, a numbering series and the renditions to produce.
  Preview makes an unnumbered draft; generating assigns the next number, renders every rendition, files them in the
  vault and links the related documents and entities. Seventeen templates ship (invoices, letters, statements, an MoU,
  a board resolution, proposals and reports).
- **MCP server.** Claude Code can search, read, preview and generate documents through tools whose business rules live
  in the server.

Dossier holds **no organisation data in code**. Names, registration ids, addresses, bank details, logos, seals,
signatures, clause texts and numbering patterns all live in a **workspace** folder that you own and keep out of git.
The repository ships only a fake example workspace (the brand "Acme Events Private Limited") and neutral placeholder
images; a test fails if anything that looks like a real identifier gets into the shipped tree.

## Quick start

Requirements: Node.js 22.13 or newer (Dossier uses the built-in `node:sqlite`). Optional: `pdftoppm` (poppler) for the
visual checks.

Limitations: the defaults target Indian businesses. Money prints as `₹` with `en-IN` digit grouping, amounts in words
use Rupees/Paise and the Thousand/Lakh/Crore system, tax labels default to GSTIN and CGST/SGST/IGST, governing law
defaults to India, and `{FY}` and the Finance folders use the April-March financial year. The currency symbol and
code, number locale, date formats and currency words are set in `workspace.json` `locale` (see
[docs/WORKSPACE.md](docs/WORKSPACE.md)), and labels and clause texts in brand and template params; the Lakh/Crore
grouping of amounts in words and the web UI's `en-IN` money grouping are fixed in this version.

```sh
npm install
npm test

node bin/dossier.js init ./workspace        # copy the example workspace and load its seed entities
export DOSSIER_HOME=$PWD/workspace
export DOSSIER_USER=demo                     # a user listed in workspace.json (clearance Confidential)
node bin/dossier.js serve                    # or: npm start
# Dossier is running at http://127.0.0.1:4400
```

Open the URL, pick **Generate**, choose a template (for example `invoice`), fill in the form, preview the draft and
generate. The document is filed under `03 Clients/…` in the vault tree with its PDF, HTML and Markdown renditions.

`npm run samples` generates one document per template from fake data into `samples-out/` without touching your
workspace, which is a quick way to see every layout.

### The new web app (in progress)

A React app in `web/` (Vite, TypeScript, Tailwind v4, shadcn) is replacing the server-rendered pages one page at a time.
The server serves its build from `web/dist` on the same port: build it once with `npm run build` (after `npm install`),
then `npm start` serves it at paths the old pages do not own, such as http://127.0.0.1:4400/vault. Until the old UI is
removed, `/` and the old pages' paths (`/search`, `/upload`, `/generate`, `/templates`, `/entities`, `/settings`,
`/documents/:id`) still show the server-rendered pages. Without a build those web-app paths answer 503 with a hint.

For development run two terminals:

```sh
npm start              # terminal 1: the API and file server on http://127.0.0.1:4400 (DOSSIER_HOME, DOSSIER_USER as above)
npm run dev:web        # terminal 2: Vite on http://127.0.0.1:5173 with hot reload
```

Open http://127.0.0.1:5173. Vite forwards `/api/`, `/assets/`, `/previews/`, `/blobs/`, `/app/` and
`/documents/:id/renditions/` to port 4400 (`DOSSIER_DEV_BACKEND` overrides the target) without rewriting the `Host`
header, so the server's same-origin check passes. `npm run typecheck` checks the web app's TypeScript.

### Command line

```text
dossier init [dir]                    create a workspace from the shipped example (default $DOSSIER_HOME or ./workspace)
dossier seed                          load seeds/entities.json (idempotent; never overwrites edits)
dossier serve [--port N] [--host H]   web UI and JSON API (default http://127.0.0.1:4400; HOST / PORT env)
dossier tree [node-id] [--folders] [--json]   print the folder tree for the current user
dossier reindex                       rebuild the full-text search index
dossier cache clear                   empty the rendered-file cache
dossier import <folder> [--index <csv>] [--dry-run] [--brand <id>] [--json]   register an existing folder
dossier help
```

Run them as `node bin/dossier.js …`, or `npm link` once to get a `dossier` command. Every command works on the
workspace in `DOSSIER_HOME` (default `./workspace`) as the user `DOSSIER_USER`.

| Variable | Default | Meaning |
|---|---|---|
| `DOSSIER_HOME` | `./workspace` | workspace folder |
| `DOSSIER_USER` | your OS user name (`mcp` for the MCP server) | acting user; clearance from `workspace.json` `users`, `Confidential` when not listed |
| `HOST`, `PORT` | `127.0.0.1`, `4400` | web server address |
| `DOSSIER_ALLOWED_HOSTS` | none | host names the web server answers; required when `HOST` is not loopback |
| `DOSSIER_ALLOW_ANY_HOST` | unset | `1` lets a non-loopback `HOST` start without `DOSSIER_ALLOWED_HOSTS` (any Host accepted; a warning is printed) |
| `DOSSIER_TEMPLATE_DIRS` | none | extra template folders (separated like `PATH`) |
| `DOSSIER_RENDER_CACHE_MB` | `500` | size of the rendered-file cache |
| `DOSSIER_DENYLIST` | none | file of regular expressions the organisation-data guard also checks (see Testing) |

## Your workspace

`dossier init` copies `workspace.example/` into a new folder. Make it yours by editing the files or the web UI's
**Settings** pages (changes apply without a restart):

```text
workspace/
├── workspace.json          name, default brand, locale, users and clearances, folder names
├── brands/<id>/brand.json  legal name, registrations, addresses, contacts, bank accounts, letterhead, footer,
│                           palette, fonts, signatories, strings, tax modes, series map, templateParams
├── brands/<id>/assets/     logo, seal, signatures, fonts
├── series.json             numbering series
├── templates/<id>/         template overrides and new templates
├── seeds/entities.json     initial clients, people, engagements, products…
└── data/                   database, stored files, caches (created on first run)
```

Put your logo, seal and signatures in `brands/<id>/assets/` (or upload them in Settings); until you do, neutral grey
placeholders print in their place. Several brands can live in one workspace; each document is issued by one brand.
Keep the workspace in a private location and back up `data/` (the database and the stored files); never commit it to
this repository. `docs/WORKSPACE.md` documents every file and field.

## Templates

Built in: `invoice`, `debit-note`, `receipt` (one shared counter; a debit note `adjusts` an invoice, a receipt `pays`
invoices and debit notes); `offer-letter`, `internship-offer`, `internship-certificate`, `experience-certificate`,
`relieving-letter`; `employee-final-settlement`, `ticketing-settlement-statement`, `client-final-settlement`,
`remittance-statement`, `expense-statement`; `mou` (Markdown body, organisation and event variants);
`board-resolution`; `proposal` and `pricing-report` (cover, contents, sections as data, fee cards and fee
calculator tables). All amounts are computed in integer paise.

Every printed string comes from the brand, the template's params or the input. To change wording:

- per brand: `brand.json` `templateParams.<templateId>` replaces whole top-level params (clause lists, labels,
  default proposal sections);
- per workspace: `templates/<id>/template.json` and/or `templates/<id>/body.md` **without** an `index.js` inherit the
  built-in code and replace only the metadata or the body (for example your own MoU text);
- a new document type: a new folder `templates/<new-id>/` with `template.json` and a `body.md` (no code needed) or an
  `index.js`.

`docs/TEMPLATES.md` is the authoring guide: fields and their sources, blocks and styles, `body.md` placeholders,
overrides, `templateParams`, numbering, warnings and a worked example.

### Numbering

Series live in `series.json`: a pattern of literal text and tokens (`{YYYY}`, `{YY}`, `{MM}`, `{FY}`, `{BRAND}`,
`{CLIENT}`, `{CODE}` and one counter such as `{####}`), a `scope` that says where the counter restarts (`global`,
`brand`, `brand+year`, `brand+year+client`, `brand+year+code`), a `start`, and `counter` to share another series'
counter. A template names a series directly or uses the brand's `series` map. Previews never take a number; generating
takes the next one in a transaction; regenerating keeps it. The generator never issues a number that a document of the
series already holds (it moves the counter past it), so a scope or pattern change cannot restart into used numbers.
Numbers set by hand (import, upload, metadata edit) move the counter past them too, and a number repeated in its series
is accepted but flagged as a conflict (`NUMBER_CONFLICT` warning). A `numberSeries` that is not in `series.json` is
refused with `SERIES_UNKNOWN`.

## Using the vault

- **Web UI** (`dossier serve`): the vault tree, document pages (metadata, versions, renditions, related entities and
  documents, status, links, new versions), upload, search, generate (a form built from the template's fields, a draft
  preview, generate or regenerate), templates, entities (create, edit, aliases, relations) and settings (brands with
  asset uploads and a live letterhead preview, number series, the workspace and its users).
- **JSON API**: the same services under `/api/…` (`/api/tree`, `/api/documents[/:id]`, `/api/search?q=`,
  `/api/templates/:id/resolve|preview|generate`, `/api/entities`, `/api/brands`, `/api/series`, `/api/workspace`,
  `/api/upload`, `/api/me`, `/api/meta`, `/api/dashboard?days=7|30|90`…). Errors are `{ code, message, details }`: `*_NOT_FOUND` 404, `FORBIDDEN` 403, duplicates, locked or
  contended states 409, validation errors 400.
- **Rules**: status moves forward only (Draft -> Sent | Signed | Superseded, Sent -> Signed | Paid | Superseded,
  Signed -> Paid | Superseded, Paid -> Superseded). Stored renditions never change; a corrected or stamped file is a new
  version. Byte-identical uploads share one stored file. Regenerating a Draft document adds a version with the same
  number; a Sent, Signed or Paid one is locked (generate a new document and supersede the old one, or pass `force`).
- **Search** looks a query up in document numbers, metadata and extracted text (PDF, HTML, Markdown, text), returns
  matching entities, and adds one hop of related documents (the quotation of an invoice, the receipt that pays it…).
- **Folder tree**: top level is who (`01 Company` … `10 Restricted`), the leaf is the kind of document; clients are
  grouped by business line, client and engagement, finance documents by Indian financial year. Rename folders or
  reroute types with `hierarchy` in `workspace.json`.
- **Caches**: reads are cached in memory and dropped on every write (also writes by another process on the same
  database); rendered files are cached on disk in `data/cache/render`.

## MCP server (Claude Code)

```sh
claude mcp add dossier --env DOSSIER_HOME=/path/to/workspace -- node /path/to/dossier/src/mcp.js
```

The server speaks MCP over stdio and offers `search`, `get_entity`, `upsert_entity`, `list_templates`,
`get_template`, `resolve_fields`, `preview_document`, `generate_document`, `link_documents`, `update_status` and
`get_document`, plus the folder tree and documents as resources. It acts as `DOSSIER_USER` (default `mcp`) with that
user's clearance, records its writes in the audit log as `mcp:<user>`, and picks up workspace changes without a
restart. It can run at the same time as the web server. A typical session: "find the last invoice for Example
Institute", "draft a receipt for it", review the preview, "generate it". See `docs/MCP.md` for the tool reference and
the security notes.

## Importing an existing folder

Bring an existing document folder (for example one laid out like the vault tree) into the vault. Always start with a
dry run, which reads and classifies everything and writes nothing:

```sh
node bin/dossier.js import /path/to/folder --dry-run        # print what would happen
node bin/dossier.js import /path/to/folder                  # register the files
node bin/dossier.js import /path/to/folder --index /path/to/folder/_index.csv --brand acme --json
```

The import only reads the source files; it never changes, moves or deletes them. In short:

- Skipped and reported: dotfiles, `node_modules`, symbolic links, generator source folders, Restricted/Security
  folders at any depth, index/spec files, and anything the secret scanner flags (`.pem`, `.key`, `.env`, PEM armour).
- Deduplicated by sha256: running the import again imports nothing new; a changed file at a known path becomes a new
  document with a `SOURCE_CHANGED` warning.
- Classified by its folders: the top-level folder gives the group (company, people, clients, vendors…), the leaf folder
  the document type, the folders between them become entities (created when missing; `Name (CODE)` adds an alias).
- Numbers are parsed from the file name or text with every series pattern; counters move past them; repeats are
  reported as conflicts.
- Sensitivity: people and identity-document folders are Confidential, the rest Internal; files above the importing
  user's clearance are skipped.

With `--index`, a CSV (`original_path,vault_path,vault_folder,md5,size_bytes,note`) lists the files; paths outside the
CSV's folder are refused. The summary lists counts, new entities, documents by type, numbers, conflicts, skipped files
and warnings (`--json` for JSON).

## Testing

```sh
npm test                    # everything: npm run test:api, then npm run test:web
npm run test:api            # API and services: unit, integration, snapshot, organisation-data guard (node --test)
npm run test:web            # web app: Vitest + Testing Library + MSW (jsdom), web/src/**/*.test.{ts,tsx}
npm run typecheck           # web app TypeScript (strict)
npm run test:unit
npm run test:integration
npm run test:snapshot
UPDATE_SNAPSHOTS=1 npm run test:snapshot   # after an intended layout change; review the diff
npm run samples [-- --template invoice] [--out dir] [--home <workspace>]
npm run visual              # compare samples-out PDFs with test/visual/baseline
npm run visual -- --update  # rewrite the baselines (always from the example workspace)
```

- **Unit and integration tests** use `node:test`, temporary folders and in-memory or temporary databases; they never
  use the network or your workspace.
- **Web app tests** run in Vitest with jsdom. API calls are answered by MSW handlers (`web/src/test/handlers.ts`) with
  the example workspace's fake data; an unhandled request fails the test.
- **Snapshot tests** render every template from the fake fixtures in `test/fixtures/inputs/` and compare the PDF
  geometry (text positions, fonts, image boxes) with `test/snapshot/__snapshots__/`.
- **Samples** (`npm run samples`) generate one final document per built-in template from the same fixtures into
  `samples-out/` (git-ignored) and print a table of template, number, pages, bytes and a sha256 prefix. The workspace
  (the example by default, or `--home <dir>`) is copied to a temporary folder first, so it is only read. Dates are
  pinned, so the same code gives byte-identical files.
- **Visual checks** (`npm run visual`) render each page of `samples-out/*.pdf` at 72 dpi with `pdftoppm` and compare it
  with `test/visual/baseline/<template>-p<N>.png` using pixelmatch (colour threshold 0.1, anti-aliasing ignored); a page
  fails when more than 0.1 % of its pixels differ, when its size differs, or when the page count changes. Diff images
  go to `samples-out/visual-diff/`. Without `pdftoppm` the check is skipped with a message. `--update` regenerates the
  samples from the example workspace in a temporary folder before writing baselines, so baselines never hold private
  data. Run `npm run samples` first.
- **Organisation-data guard** (`test/unit/no-org-data.test.js`, also `node scripts/org-data-guard.js`) scans `src/`,
  `assets/`, `workspace.example/`, `test/`, `scripts/`, `bin/`, `docs/` (all of it), this README, `package.json` and
  `.gitignore` for values shaped like real Indian GSTIN, CIN, PAN and IFSC codes, 11-18 digit account numbers and `+91`
  phone numbers (only the listed fake example values are allowed), and for e-mail addresses whose domain is not one of
  the reserved example domains `example.com`, `example.org`, `example.net` or a subdomain of them (the allow-list is
  `EMAIL_DOMAIN_ALLOW` in the script). Numbers written with grouping (`5020 0012 3456`) and lowercase identifiers are not detected, so
  put those in the denylist too. Point `DOSSIER_DENYLIST` at a file outside the repo with one regular expression per line
  (case-insensitive), such as your organisation, client and people names, to check those too:
  `DOSSIER_DENYLIST=~/dossier-denylist.txt npm test`. Maintainers should run the guard with their denylist before every
  push.

## Architecture

```text
bin/dossier.js, bin/dossier-mcp.js   entry points
src/cli.js                           command table
src/server.js, src/web/              Fastify server: routes, server-rendered views, JSON API
src/mcp.js                           MCP server (stdio)
src/context.js                       openContext({ home, user }) -> { config, ws, db, repo, user }
src/workspace/                       workspace loader and schema validation
src/db/                              node:sqlite, migrations, repository (audit log on every write)
src/domain/                          pure rules: numbering patterns, status transitions, sensitivity, routing
src/services/                        documents, upload, search, entities, hierarchy, templates, fields, generator,
                                     numbering, importer, workspace files
src/render/                          PDF primitives and frames (pdfkit), blocks, HTML and Markdown renderers
src/templates/<id>/                  built-in templates (template.json + index.js / body.md)
src/cache/                           in-memory memo and disk render cache
web/                                 the new web app (React, Vite, TypeScript; npm workspace @dossier/web), built to web/dist
workspace.example/                   the fake example workspace
```

The web UI, the CLI and the MCP server are thin layers over the same services (`fn(ctx, …)`), which hold every
business rule; nothing else touches SQL. Plain JavaScript (ESM) with JSDoc, no build step. `docs/PLAN.md` describes the
design and data model; `docs/DECISIONS.md` records the decisions and their reasons.

## Security notes

- **Local only, no login.** The web server listens on `127.0.0.1` and answers only requests whose `Host` is a
  loopback name. Anyone who can reach the port acts as `DOSSIER_USER`. To listen elsewhere set `HOST` and limit names
  with `DOSSIER_ALLOWED_HOSTS`, and put an authenticating reverse proxy in front; multi-user access is out of scope.
  A non-loopback `HOST` without `DOSSIER_ALLOWED_HOSTS` refuses to start (`HOST_UNSAFE`), because the server would
  then answer any Host header (DNS rebinding) with no login; `DOSSIER_ALLOW_ANY_HOST=1` overrides this and prints a
  warning to stderr on every start.
- **Same-origin writes.** Every POST/PUT/PATCH/DELETE must carry an `Origin` (or `Referer`) whose host equals the
  `Host`; a request without either is accepted only with a JSON body, a non-POST method or an `X-Dossier-Client`
  header, none of which a cross-site page can send without a CORS preflight.
- **Clearance.** Sensitivity is `Public < Internal < Confidential < Restricted`. A user's clearance (`workspace.json`
  `users`, default `Confidential`) is checked on every read, list, search and write, in the web UI, the API and the MCP
  tools; documents above it are left out of results, and opening one directly is `FORBIDDEN`. Restricted documents
  appear only in `10 Restricted` and only for users cleared for Restricted. Clearance filters what the app returns; it
  does not protect the workspace files from someone (or an agent) who can read the folder: see `docs/MCP.md`.
- **Files only through documents.** Stored bytes are served only through a document the user may read; non-PDF files
  carry `Content-Security-Policy: sandbox`, so an uploaded HTML or SVG file cannot script the app.
- **Preview tokens.** Draft previews are written to `data/previews/<token>/` and served at `/previews/<token>/…`. The
  token is a sha256 of the template, the input and the brand: it is not listed anywhere and is hard to guess without
  the exact inputs, but whoever has the URL can open the preview; previews are not clearance-checked beyond the
  template check made when the preview is created.
- **No secrets in the vault.** Uploads named `*.pem`, `*.key`, `*.env`, `.env*`, or whose bytes or text contain PEM
  armour or `PRIVATE KEY`, are refused (`SECRET_REJECTED`). Keep keys and passwords in a password manager.
- **Audit.** Every write is recorded in `audit_log` with the actor (`<user>`, or `mcp:<user>` for the MCP server).

## Status and limitations

Version 0.1. The vault, the generator with all seventeen templates, the web UI and settings, the MCP server, the caches
and the importer are complete and covered by tests. Known limitations:

- Single workspace and single acting user per process; no login or per-user sessions.
- The HTML rendition is a web rendition with the same fonts and metrics, not a line-for-line facsimile of the PDF.
- Text is extracted for search only from PDF, HTML, Markdown and plain-text files (no OCR).
- Templates that used the Figtree font (portfolio, a society-branded header) are not included.
- Body placeholders insert values raw, so a field value can add Markdown structure (see `docs/TEMPLATES.md`).

## Documentation

- `docs/WORKSPACE.md`: creating and customising a workspace (brands, assets, series, seeds, settings).
- `docs/TEMPLATES.md`: the template authoring guide and the built-in templates.
- `docs/MCP.md`: the MCP server: setup, tools, resources and security.
- `docs/PLAN.md`: architecture, data model, rules, caches, testing and build order.
- `docs/DECISIONS.md`: decisions and their reasons.
- `docs/BUILD_LOG.md`: how the app was built: features, reviews, rulings, incidents and open items.
- `docs/DISCOVERY.md`: findings from the legacy document scripts this app replaces (redacted).

## License

Code: MIT. Bundled Manrope fonts: SIL Open Font License (`assets/fonts/Manrope/OFL.txt`).
