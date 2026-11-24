# Templates

A template is a folder `<templateId>/` holding `template.json` (metadata and field schema) and `index.js` (the
renderer module), `body.md` (a Markdown body), or both. This is the first version of the format; later tasks extend it.

## Where templates come from

`listTemplates(ctx)` (`src/services/templates.js`) reads, in this order, later folders overriding earlier ones with
the same id:

1. built-ins: `src/templates/<id>/`
2. extra folders: `listTemplates(ctx, { dirs })`, else `ctx.templateDirs`, else `DOSSIER_TEMPLATE_DIRS` (folders
   separated like `PATH`; used by tests and for sharing templates between workspaces)
3. the workspace: `<workspace>/templates/<id>/`

The folder name must equal `id`. A template that does not validate makes `listTemplates` / `getTemplate` throw
`TEMPLATE_INVALID` with the file and the field (`templates/offer/template.json: invalid:\n  category: …`).

Every listed template is registered in the `templates` table (`id`, `version`, `source` = `builtin` | `workspace`,
`path`, `hash`, `meta_json`). The hash is a SHA-256 over the bytes of `template.json`, `index.js` and `body.md`, so
editing any of them registers a new hash (audited as `template.update`). `getTemplate(ctx, id)` returns
`{ id, meta, module, body?, hash, source, path }`; the module is re-imported when the hash changes.

## template.json

```json
{
  "id": "offer-letter", "version": 1, "type": "Offer Letter", "title": "Offer letter",
  "category": "letter", "layoutProfile": "letter", "partyType": "Person", "partyKind": "person",
  "sensitivity": "Confidential", "renditions": ["pdf", "html", "md"],
  "numbering": { "series": "brand", "required": true }, "contact": "hr",
  "params": { "subject": "Letter of appointment" },
  "fields": [
    { "name": "brand", "source": "brand", "required": true },
    { "name": "employee", "label": "Employee", "source": "entity:person", "required": true },
    { "name": "address", "source": "employee.attrs.address", "type": "text" },
    { "name": "date", "source": "today", "type": "date" },
    { "name": "salary", "label": "Monthly salary", "source": "ask", "type": "money", "required": true },
    { "name": "annual", "source": "computed:annual", "type": "money" },
    { "name": "signatory", "source": "signatory", "required": true }
  ],
  "relations": [{ "type": "based_on", "field": "employee", "optional": true }],
  "leaf": "Offer Letters"
}
```

| Key | Default | Notes |
|---|---|---|
| `id` | required | lowercase letters, digits, `-`, `_`; equals the folder name |
| `version` | required | integer ≥ 1 |
| `type` | required | document type (used for folder routing) |
| `title` | required | shown in the UI |
| `description` | none | |
| `category` | required | `invoice`, `letter`, `statement`, `agreement`, `proposal`, `report`, `resolution` |
| `layoutProfile` | required | `invoice`, `letter`, `settlement`, `proposal`, `compact`, `mou` (`src/render/pdf/profiles.js`) |
| `partyType` | required | `Company`, `GroupEntity`, `Person`, `Client`, `Vendor`, `Product` |
| `partyKind` | required | entity kind of the party |
| `sensitivity` | required | `Public`, `Internal`, `Confidential`, `Restricted` |
| `renditions` | `["pdf","html","md"]` | |
| `numbering` | `null` | `{ "series": "brand" \| "<seriesId>", "required": true }`; `brand` uses the brand's `series[<templateId>]`; a series id must exist in `series.json` |
| `contact` | `default` | brand contact used for `{contact.*}` in letterhead and footer |
| `params` | `{}` | free data for the renderer (labels, column layout, toggles, clause text) |
| `fields` | required | see below |
| `relations` | `[]` | `[{ type, field, optional }]`: a document relation type and the field holding the related document |
| `leaf` | none | folder leaf override |

Unknown keys are errors (typos do not pass silently).

### Fields

`{ name, label?, source, type?, required (false), enum?, default?, item?, help? }`

`name` is an identifier or a dotted path (`billTo.name` resolves into `values.billTo.name`). Fields resolve in order,
so a field can read the ones before it.

| `source` | Value |
|---|---|
| `ask` | from the input only |
| `today` | today's date, `YYYY-MM-DD` |
| `brand` | the resolved brand object |
| `brand.<path>` | a path into the brand: `brand.legalName`, `brand.bankAccounts.0` (or `[0]`) |
| `entity:<kind>` | the input is an entity id or name (aliases work); resolves to the entity record (`id`, `kind`, `name`, `attrs`, `aliases`, `relations`…); unknown names are errors |
| `<field>.<path>` | a path into an earlier field, e.g. `client.attrs.address` |
| `signatory` | the input is a signatory id; default `brand.defaultSignatory[templateId]`, else `[category]`; resolves to the signatory object |
| `computed:<name>` | `module.computed[name](values, env)` with the values resolved so far |
| `const:<json>` | a literal JSON value |

Input always wins over a non-`ask` source when it is provided (input keys may be nested or dotted). When the value is
still empty, `default` applies: a literal, or a source when it is a string `today`, `brand`, `brand.<path>`,
`const:<json>` or `computed:<name>`. `enum` is a list, or a source resolving to a list (objects contribute their
`id`, e.g. `"enum": "brand.tax.modes"`).

Types coerce input values:

| `type` | Coercion |
|---|---|
| `string` / `text` | text (`string` is trimmed) |
| `money` | integer minor units (paise). Input numbers and strings are major units: `1500`, `"₹1,20,000.50"`, rounded half up at the third decimal. `computed` functions return minor units already |
| `date` | ISO `YYYY-MM-DD` from `YYYY-MM-DD[T…]`, `DD/MM/YYYY` (`-` or `.` also), or a Date |
| `number`, `boolean` | `"1,234.5"`; `yes/no/true/false/1/0` |
| `enum` | text that must be in `enum` |
| `entity` | an entity (as `entity:<kind>` without a kind check) |
| `array` | a list; `item` (`{ "amount": "money", … }`) coerces each item's keys |
| `object` | a plain object |

`resolveFields(ctx, templateId, input, { brandId })` (`src/services/fields.js`) returns
`{ values, missing, errors }`: `missing` lists required fields still empty as `{ name, label, type, enum?, help? }`
(the UI form and the MCP agent ask for these); `errors` lists `{ name, message }` for bad values, unknown entities or
signatories, values outside `enum` and failing computed functions (array items are named `items.2.amount`).

## index.js

All exports are optional:

| Export | Purpose |
|---|---|
| `computed` | `{ <name>: (values, env) => value }` for `computed:<name>` fields |
| `blocks(values, env)` | returns the document as blocks; the PDF, HTML and Markdown renderers all consume them (letter-class templates) |
| `style` | block style overrides for `renderBlocksPdf` and `blocksToHtml` (see below) |
| `pdfCustom` | `{ <name>: async (pdfCtx, data, style) => void }` draw functions for `custom` blocks |
| `renderPdf(pdfCtx, values, env)` | hand-written PDF for absolutely positioned layouts (invoice family); draws into the `createPdf` context |
| `renderHtml(values, env)` | hand-written HTML (a full document string) for templates without blocks |

`env` is `{ ctx, brand, meta, params, fmt, input }` (`fmt` is the locale formatter: `money`, `number`, `date`,
`amountInWords`). Everything printed must come from the brand, `params` or the values: no literal organisation data.

## body.md

A Markdown body filled with `fillMarkdown(body, values)` (`src/render/md/fill.js`): `{{path}}`,
`{{#each list}}…{{/each}}` with `{{this}}`, `{{this.x}}`, `{{@index}}` (0-based) and `{{@index1}}` (1-based), and
`{{#if path}}…{{else}}…{{/if}}` (empty lists/objects, `''`, `0` are false). Names inside `each` resolve against the item
first. A section tag alone on its line removes that line. Nothing is escaped. Missing values print as empty text and
are returned in `missing`; unbalanced tags throw `TEMPLATE_SYNTAX` with the line number.

The filled Markdown is stored as the Markdown rendition and parsed with `parseMarkdownBlocks(md)`
(`src/render/md/parse.js`) for PDF and HTML, following the legacy MoU parser: `#`–`###` headings (deeper levels become
3), `---`/`***`/`___` dividers, `-`/`*` bullets, `1.`/`1)` numbered items, `|` tables with an optional alignment row,
paragraphs (consecutive lines joined by a space), standalone HTML tags skipped. When the text has a divider, blocks
before the first one are flagged `cover: true` (rendered centred). Each `## For …` heading starts a signature
section and becomes a `signature` block with `party` = the heading and `lines` = the section's paragraphs and list
items; other blocks after the first `## For …` are dropped.

## Blocks

`src/render/blocks.js`. Text may contain `**bold**`.

| Block | Shape |
|---|---|
| heading | `{ type: 'heading', level: 1..3, text, align? }` |
| paragraph | `{ type: 'paragraph', text, align? }` (`justify`, `left`, `center`; `right` is HTML-only) |
| bullets / numbered | `{ type: 'bullets' \| 'numbered', items: [text] }` |
| table | `{ type: 'table', columns: [label \| { key?, label, width?, align? }], rows: [[cells] \| { key: cell }], totalRows?, header?: false }` |
| keyValue | `{ type: 'keyValue', rows: [[key, value]] }` |
| signature | `{ type: 'signature', signatoryId?, party?, lines?: [text] }`: with `signatoryId` the brand signatory's image, name and title (and seal) under `party` (default `brand.strings.forCompany`); without, `party`, a blank sign line and `lines` |
| spacer | `{ type: 'spacer', size }` (points) |
| divider, pageBreak | `{ type: 'divider' }`, `{ type: 'pageBreak' }` |
| custom | `{ type: 'custom', name, data }`: PDF calls `pdfCustom[name]`; HTML inserts `data.html` as given (escape what you put there) or `data.text`; Markdown uses `data.md` or `data.text` |

Any block may carry `cover: true`.

### Style

`renderBlocksPdf(pdfCtx, blocks, style, { custom })` (`src/render/pdf/blocks.js`) draws with the PDF primitives.
`style` deep-merges over `BLOCK_STYLE_DEFAULTS`, the offer-letter values (docs/DISCOVERY.md A8 §2):

| Key | Default |
|---|---|
| `heading.1` | `BodyBold 17`, upper-case, lineGap 2, before 0.5 / after 0.65 lines, page break when < 60 pt remain |
| `heading.2` | `BodyBold 12`, lineGap 1.5, 0.35 / 0.45, break < 90 |
| `heading.3` | `BodyBold 10.5`, lineGap 1.5, 0.3 / 0.35, break < 60 |
| `paragraph` | `BodyRegular 10.5`, lineGap 4.5, justified, after 0.65, colour `body` |
| `bullets` | `•` at `ML + 5`, text indent 14, item after 0.35, list after 0.45 |
| `numbered` | `1.` at `ML`, text indent 18, otherwise as bullets |
| `table` | header `BodyBold 9.5` white on `ink`, h22; rows `BodyRegular 9.5` h22, fills `fillAlt`/`white`, pad 10; total rows bold on `fillTotal`; before 0.35 / after 0.9 |
| `keyValue` | label `Regular 10` colour `label` in 130 pt, value `SemiBold 10` `ink` prefixed `:  `, row h19 |
| `signature` | 20 pt gap; signature block defaults (image h55, seal); extra lines `Regular 9` `muted` every 12 pt after the title; `block` passes options to `drawSignatureBlock` (e.g. `{ seal: null }`) |
| `divider` | hairline 0.4 `rule`, 0.5 / 0.65 |
| `coverHeading`, `coverParagraph` | applied on top for `cover: true` blocks (centred) |

Colours are palette keys (`ink`, `body`, `muted`…) or hex values.

## HTML and Markdown renditions

`blocksToHtml(blocks, { brand, ws, title, style, styleVars, standalone, profileId, contact })`
(`src/render/html/index.js`) returns a full HTML document: A4 (`@page { size: A4; margin: 0 }`), one `.page` padded
by the layout profile margins, CSS in pt from the same block style (line heights = size × 1.366 + lineGap, as pdfkit
measures Manrope), the brand letterhead and footer (footer slots using `{page}`/`{pages}` are left out). All text is
escaped. Fonts are `@font-face` rules: with `standalone: true` (vault renditions) fonts are embedded as base64 and the
logo and signature images as data URIs; otherwise they load from `/assets/fonts/<Family>/<file>.ttf` (bundled fonts),
`/assets/brands/<id>/fonts/<file>`, `/assets/brands/<id>/logo` and `/assets/brands/<id>/signatures/<signatoryId>`
(served by the HTTP server). `styleVars` overrides CSS custom properties (the palette is exposed as `--ink`,
`--body`, …). The HTML is a web rendition with the same fonts and metrics, not a line-for-line facsimile of the PDF.

`blocksToMarkdown(blocks, { brand, title })` (`src/render/md/index.js`) writes GitHub-flavoured Markdown: headings,
paragraphs, lists, pipe tables (total rows bold, `|` escaped), key/value rows as `- **Key:** value`, signatures as
lines, `---` dividers and `<!-- page break -->`.
