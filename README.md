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
node bin/dossier.js init  # create ./workspace from the fake example (or: init <dir>)
export DOSSIER_HOME=$PWD/workspace
```

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

## Generating documents

`previewDocument` and `generateDocument` (`src/services/generator.js`) turn a template and an input into documents. A preview renders every rendition with the number shown as `DRAFT` and a `DRAFT — NOT NUMBERED` watermark on each PDF page, under `data/previews/<token>/`, and writes nothing to the vault. Generating allocates the next number of the template's series, renders PDF, HTML and Markdown with it, and files one document (party, date, amount, sensitivity, issuing brand) with version 1, the `generated_from` template link, declared relations and party/signatory/issuer entities. Regenerating a Draft document adds a version with the same number; Sent, Signed or Paid documents are superseded instead (or regenerated with `force`). See `docs/TEMPLATES.md`.

## Documentation

- `docs/PLAN.md`: architecture, data model, rules, cache layers, testing and build order.
- `docs/DISCOVERY.md`: findings from the legacy document scripts this app replaces (redacted).
- `docs/WORKSPACE.md`: creating and customising a workspace (brands, assets, series, seeds).
- `docs/TEMPLATES.md`: template folders, `template.json` fields and sources, the block model, the PDF/HTML/Markdown renderers and generation.
- `docs/DECISIONS.md`: small decisions and their reasons.

## License

Code: MIT. Bundled Manrope fonts: SIL Open Font License (`assets/fonts/Manrope/OFL.txt`).
