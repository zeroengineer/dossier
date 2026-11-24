# MCP server

`src/mcp.js` is an MCP server that lets Claude Code (or any other MCP client) search the vault, look up entities, and
fill, preview and generate documents. It speaks MCP over stdio. Every tool calls the same services as the web UI and
the CLI, so it follows the same rules: clearance, numbering, status lifecycle, audit.

## Setup

You need a workspace (`node bin/dossier.js init /path/to/workspace`, see `docs/WORKSPACE.md`). Register the server
with Claude Code:

```sh
claude mcp add dossier --env DOSSIER_HOME=/path/to/workspace -- node /path/to/dossier/src/mcp.js
```

Add `--env DOSSIER_USER=<user>` to act as a user listed in `workspace.json` `users` (see "Security" below). The
`dossier-mcp` bin (`bin/dossier-mcp.js`) and `npm run mcp` start the same server.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOSSIER_HOME` | `./workspace` | Workspace folder. Set it: Claude Code starts the server from an unpredictable folder. |
| `DOSSIER_USER` | `mcp` | Local user whose clearance applies. A user not listed in `workspace.json` gets `Confidential`. |
| `DOSSIER_TEMPLATE_DIRS` | none | Extra template folders, as for the web server. |

The process opens one workspace and one database connection (WAL mode, so the web server can run at the same time
on the same workspace). stdout carries only JSON-RPC; the start-up line, the SQLite experimental warning and any
diagnostics go to stderr. The server stops when the client closes stdin.

**Workspace changes apply without a restart.** Before each tool call and resource read the server compares the size
and modification time of `workspace.json`, `series.json`, `seeds/entities.json` and every `brands/<id>/brand.json`
with the last load. When they changed it reloads the workspace, recomputes the user's clearance and updates the brand
rows. Saves from the web settings therefore apply to the next MCP call. If a file stops loading (a broken hand edit),
the server fails closed. Every tool call and resource read returns `WORKSPACE_INVALID`, naming the file, until the
files load again. It does not keep working with the old workspace, because the old clearance may no longer be right.
The error is also reported on stderr. Templates are read
from disk on every call anyway. The server caches no database data, so documents and entities written by the web
server are visible at once.

## Results and errors

Every tool returns one text item holding JSON. The same object is in `structuredContent`. The tools never return
file contents, only absolute paths to the files (previews under `<workspace>/data/previews/<token>/`, filed renditions in
the content-addressed blob store `<workspace>/data/blobs/<2 hex>/<sha256>`). Claude Code can open those paths
itself if it has read access to the workspace's `data` folder (see "Security"). Blob files have no extension; the rendition's `filename` and `kind` tell what they hold. Treat them as
read-only, because one blob can back several documents.

A failure is a result with `isError: true` and this content:

```json
{ "code": "STATUS_LOCKED", "message": "DOC-000003 is Sent; regenerating would put it back to Draft. …",
  "hint": "Generate a new document and call supersede(old, new), or regenerate with force: true",
  "details": { "documentId": "DOC-000003", "status": "Sent" } }
```

`code` is the service's stable error code (`INVALID_INPUT`, `FIELDS_MISSING`, `FIELDS_INVALID`, `FORBIDDEN`,
`*_NOT_FOUND`, `ENTITY_DUPLICATE`, `ENTITY_AMBIGUOUS`, `STATUS_LOCKED`, `INVALID_STATUS_TRANSITION`,
`NUMBER_CONTENDED`, `WORKSPACE_INVALID`, …). `hint` says what to do next. Arguments that fail the tool's schema are
`INVALID_INPUT`. That includes unknown or misspelled keys: every tool's schema has `additionalProperties: false`, so
`documentId` instead of `document_id` is refused rather than ignored. An unknown tool is `TOOL_NOT_FOUND`, any other
refusal by the MCP layer is `MCP_ERROR`, and an unexpected failure is `INTERNAL` with no internals (the stack trace goes to
stderr).

## Tools

### `search`

`{ q, types?, status?, limit? }`. Searches filed documents by number, title, party names and aliases, and
extracted text. All words must match. `types` and `status` take one value or a list; `limit` is 1–200 (default 20).
Returns `hits` (`document` summary, `score`, `match`: `number|metadata|text`, `snippet` with matches in `[ ]`),
`related` (documents one relation or one entity away) and `entities` (master-list matches). Only documents within the
user's clearance are returned.

```json
{ "q": "EISS debit", "types": "Debit Note", "status": ["Draft", "Sent"], "limit": 5 }
```

### `get_entity`

`{ id_or_name, kind? }`. Returns one entity by id, name or alias: aliases, attributes, relations in both directions
and the number of documents that reference it. If the name matches entities of several kinds you get
`ENTITY_AMBIGUOUS`; pass `kind` to choose one.

```json
{ "id_or_name": "EISS", "kind": "client" }
```

### `upsert_entity`

`{ kind, name, aliases?, attrs?, alias_of? }`. Creates an entity, or updates the one of the same kind with that name.
Aliases are only added, never removed. `attrs` are merged, and a `null` value deletes a key. If the name or an alias
already belongs to another entity you get `ENTITY_DUPLICATE` with `details.existingId`. To record the name as another
spelling of that entity, pass `alias_of` (an id, a name or an alias). The name and aliases are then added as aliases of
it and nothing is created.

```json
{ "kind": "client", "name": "Example Institute of Sample Studies", "aliases": ["EISS"],
  "attrs": { "address": ["1 College Road", "Example City 000000"], "email": "accounts@example.com" } }
{ "kind": "client", "name": "Example Institute", "alias_of": "EISS" }
```

### `list_templates`

`{}`. Returns `templates` (id, version, type, title, category, source, description, sensitivity, renditions,
numbering, and `usable`, which is false when the template is above the user's clearance) and `errors` (template
folders that failed to load, with code and message).

### `get_template`

`{ id, brand_id? }`. Returns one template: the `fields` to fill (name, label, type, required, help, source, entity
kind of pickers, `choices` of enums, `item` with the column types of list rows), the effective `params` for the brand
(template params merged with the brand's `templateParams`), plus `numbering`, `renditions`, `sensitivity` and `usable`.

```json
{ "id": "debit-note", "brand_id": "acme" }
```

### `resolve_fields`

`{ template_id, input, brand_id? }`. Fills the template's fields from `input`, entities, the brand and defaults,
without rendering. Returns `values`, `missing` (required fields with no value) and `errors` (bad values, unknown
entities). Call it to find out what to ask the user for.

```json
{ "template_id": "debit-note", "input": { "client": "EISS", "items": [{ "description": "Travel", "amount": "3,066.50" }] } }
```

### `preview_document`

`{ template_id, input, brand_id? }`. Renders a draft: the number shows as `DRAFT` and every PDF page has a
`DRAFT — NOT NUMBERED` watermark. Nothing is filed and no number is used. Returns `ok: true`, `token`, `renditions`
(`kind`, `path`, `bytes`), `warnings` (for example `PLACEHOLDER_EMPTY`: a body placeholder that printed as empty
text) and a one-line `summary`. If fields are missing or invalid it returns `ok: false` with `missing`, `errors` and
`summary`. This is not an error result, because it tells you what to fill in.

```json
{ "template_id": "debit-note", "input": { "client": "EISS", "date": "2026-07-16",
  "items": [{ "description": "Travel", "amount": "3,066.50" }] } }
```

### `generate_document`

`{ template_id, input, brand_id?, status?, document_id?, force?, note? }`. Renders and files a document. It allocates
the next number of the template's series, stores every rendition, links the template and the declared relations, and
returns `documentId`, `number`, `versionNo`, `renditions` (`kind`, `sha256`, `filename`, `bytes`, `path`),
`warnings` and `summary`. `status` sets the initial status (default `Draft`). Missing or invalid fields give
`FIELDS_MISSING` / `FIELDS_INVALID` with the lists in `details`.

To regenerate, pass `document_id`. This adds the next version of that document with the same number (same template
and brand). A `Sent`, `Signed` or `Paid` document gives `STATUS_LOCKED` unless you pass `force: true`, which resets it
to `Draft` (or keeps the status named in `status`) and audits the reset. Usually it is better to generate a new
document and link it with `supersedes`.

```json
{ "template_id": "debit-note", "input": { "client": "EISS", "items": [{ "description": "Travel", "amount": "3,066.50" }] } }
{ "template_id": "debit-note", "input": { "…": "…" }, "document_id": "DOC-000003", "force": true, "note": "Corrected amount" }
```

### `link_documents`

`{ from_id, to_id, type }`. Relates two documents as `from_id --type--> to_id`. `type` is one of `based_on`, `pays`,
`settles`, `adjusts`, `follows`, `generated_from`, `supersedes`, `rendition_of`.

```json
{ "from_id": "DOC-000007", "to_id": "DOC-000003", "type": "pays" }
```

### `update_status`

`{ document_id, status }`. Moves a document along its lifecycle: Draft to Sent or Signed, Sent to Signed or Paid,
Signed to Paid, and any status to Superseded, which is final. Any other move gives `INVALID_STATUS_TRANSITION`.

```json
{ "document_id": "DOC-000003", "status": "Sent" }
```

### `get_document`

`{ id }`. Returns the full metadata of one document: type, title, party, number, dates, amount, status, sensitivity,
template, issuing brand and entity, every version with its renditions (each with its file `path`), related entities
with roles and related documents in both directions.

```json
{ "id": "DOC-000003" }
```

## Resources

- `dossier://tree`: the vault folder tree as JSON, for the user's clearance (the same view as
  `node bin/dossier.js tree --json`).
- `dossier://document/{id}`: one document, the same as `get_document`.

## Security

- **Clearance filters tool results. It does not isolate the agent.** The server acts as one local user,
  `DOSSIER_USER` (default `mcp`). Its clearance comes from `workspace.json` `users` (`Confidential` when the user is
  not listed). The tools leave documents above that clearance out of search, the tree and related lists. `get_document`
  on such a document gives `FORBIDDEN`, and so does previewing or generating from a template above it. A change to
  `users` applies to the next call. Setting a lower clearance for the MCP user, for example
  `"mcp": { "clearance": "Internal" }`, therefore limits what the tools return. It does **not** limit an agent that can
  read the workspace files directly: `data/blobs/` holds every rendition, `data/dossier.sqlite` holds all metadata and
  extracted text, and the brand and workspace files sit next to them. Claude Code can read any file its operating-system
  user can read. For real isolation, run Claude Code where it cannot read the workspace folder: a working directory
  outside it with file permissions that deny it, or a different operating-system user. The MCP server must still be
  able to read it. When the agent cannot read `data/`, use the documents' paths through `get_document` only as
  references.
- **Audit.** Every write (documents, versions, status, links, entities, numbers) is recorded in `audit_log` with the
  actor `mcp:<user>`, so MCP changes are distinct from changes made in the web UI or the CLI.
- **No secrets.** The tools never return file bytes or environment variables, and they return no configuration
  beyond the workspace data the user's clearance allows. Do not put credentials in entity attributes or inputs: they are stored and audited in
  plain text. Files that look like keys (`.pem`, `.key`, `.env`, PEM armour) are refused by the vault
  (`SECRET_REJECTED`).
- **Local only.** stdio means the server is reachable only by the process that started it. There is no network
  listener and no authentication beyond the operating-system user running it.
