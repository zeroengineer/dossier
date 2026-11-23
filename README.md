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

## Documentation

- `docs/PLAN.md`: architecture, data model, rules, cache layers, testing and build order.
- `docs/DISCOVERY.md`: findings from the legacy document scripts this app replaces (redacted).
- `docs/WORKSPACE.md`: creating and customising a workspace (brands, assets, series, seeds).
- `docs/DECISIONS.md`: small decisions and their reasons.

## License

Code: MIT. Bundled Manrope fonts: SIL Open Font License (`assets/fonts/Manrope/OFL.txt`).
