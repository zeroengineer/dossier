# Templates

A template is a folder `<templateId>/` holding `template.json` (metadata and field schema) and `index.js` (the
renderer module), `body.md` (a Markdown body), or both; `body.<name>.md` files add named bodies (see body.md). This is
the first version of the format; later tasks extend it.

## Where templates come from

`listTemplates(ctx)` (`src/services/templates.js`) reads, in this order, later folders overriding earlier ones with
the same id:

1. built-ins: `src/templates/<id>/`
2. extra folders: `listTemplates(ctx, { dirs })`, else `ctx.templateDirs`, else `DOSSIER_TEMPLATE_DIRS` (folders
   separated like `PATH`; used by tests and for sharing templates between workspaces)
3. the workspace: `<workspace>/templates/<id>/`

The folder name must equal `id`. A folder that does not load (bad JSON, schema error, unknown series, no
`index.js`/`body.md`) is left out of `listTemplates` and reported by `listTemplateErrors(ctx)` as
`{ id, source, path, code, message, details }`; it never affects other templates. `getTemplate(ctx, id)` for that id
throws `TEMPLATE_INVALID` with the file and the field (`templates/offer/template.json: invalid:\n  category: …`). A
broken workspace override is not replaced by the built-in it overrides: its id fails until it is fixed.

### Workspace overrides that inherit

A workspace folder whose id a built-in (or extra) folder already provides and that has **no `index.js`** inherits from
that template instead of replacing it:

| Part | Used |
|---|---|
| module | the built-in `index.js` (its `computed`, `renderPdf`, `renderHtml`, `blocks`…) |
| meta | the workspace `template.json` when present (it replaces the built-in meta whole and must keep the same `id`, i.e. the folder name); otherwise the built-in `template.json` |
| bodies | the workspace `body.md` / `body.<name>.md` when present, file by file; otherwise the built-in's |

So a private workspace can supply its own MoU text with only `templates/mou/body.md` (and `body.event.md`), or change
labels and defaults with only `templates/<id>/template.json`, while the layout code stays the shipped one. The entry is
listed with `source: "workspace"`, `path` = the workspace folder and `inherits` = the built-in folder. A broken
override is reported like any other (bad JSON, schema error, a `computed:` field the built-in module does not export,
a built-in that does not load itself: "inherits from a built-in template that does not load: …") and its id fails. A
workspace folder with `body.md`, a named body or `index.js` but no `template.json` and no built-in of the same id is
reported as `no template.json and no built-in template "<id>" to inherit from`. A folder with an `index.js` is a full
override, as before, and needs its own `template.json` (without one it is reported as `index.js without
template.json: …`; remove `index.js` to inherit instead).

Every listed template is registered in the `templates` table (`id`, `version`, `source` = `builtin` | `workspace`,
`path`, `hash`, `meta_json`). The hash is a SHA-256 over the bytes of `template.json`, `body.md`, the named bodies and
every `.js` file in the folder (sub-folders included), so editing any of them registers a new hash (audited as
`template.update`). An inheriting override's hash is a SHA-256 over its own files' hash and the built-in template's
hash, so a change to either folder (the workspace body or meta, or the built-in module) registers a new hash.
`getTemplate(ctx, id)` returns `{ id, meta, module, body?, bodies?, hash, source, path, inherits? }`; `index.js` is
re-imported when the module folder's hash changes (helper modules it imports stay cached by Node until the process
restarts).

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
| `relations` | `[]` | `[{ type, field, optional }]`: a document relation type and the field holding the related document id, or a list of ids (one relation each; duplicates linked once) |
| `leaf` | none | folder leaf override |

Unknown keys are errors (typos do not pass silently).

### Fields

`{ name, label?, source, type?, required (false), enum?, default?, item?, help? }`

`name` is an identifier or a dotted path (`billTo.name` resolves into `values.billTo.name`); the segments
`__proto__`, `constructor` and `prototype` are not allowed, and paths only follow own properties. Fields resolve in
order, so a field can read the ones before it.

| `source` | Value |
|---|---|
| `ask` | from the input only |
| `today` | today's date, `YYYY-MM-DD` |
| `brand` | the resolved brand (a frozen copy) |
| `brand.<path>` | a path into the brand: `brand.legalName`, `brand.bankAccounts.0` (or `[0]`) |
| `entity:<kind>` | the input is an entity id or name (aliases work); resolves to the entity record (`id`, `kind`, `name`, `attrs`, `aliases`, `relations`…); unknown names are errors |
| `<field>.<path>` | a path into an earlier field, e.g. `client.attrs.address` |
| `signatory` | the input is a signatory id; default `brand.defaultSignatory[templateId]`, else `[category]`; resolves to the signatory object |
| `computed:<name>` | `module.computed[name](values, env)` with the values resolved so far |
| `const:<json>` | a literal JSON value |

Input always wins over a non-`ask` source when it is provided (input keys may be nested or dotted). Blank input
(`''` or whitespace only, as HTML forms post) counts as not provided: sources and defaults apply, and a required
field that stays empty is listed in `missing`. When the value is
still empty, `default` applies: a literal, or a source when it is a string `today`, `brand`, `brand.<path>`,
`const:<json>` or `computed:<name>`. `enum` is a list, or a source resolving to a list (objects contribute their
`id`, e.g. `"enum": "brand.tax.modes"`).

Types coerce input values:

| `type` | Coercion |
|---|---|
| `string` / `text` | text (`string` is trimmed) |
| `money` | integer minor units (paise). Input numbers and strings are major units: `1500`, `"₹1,20,000.50"`, `"Rs. 500"`, `"INR 120,000"` (grouping `120,000` or `1,20,000`; `1,2,3` is rejected), rounded half up at the third decimal. Values from `computed` functions, and `<field>.<path>` reads of a value that was itself coerced as money earlier (a `money` field, or an array item key typed `money` such as `items.0.amount`), are minor units already and are not scaled again (they must be integers). Any other path (into an `object` field, brand data, an entity record, a constant) is raw input and is scaled once |
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
`amountInWords`); when rendering it also has `number`, `draft` and `markdown` (the filled body, if the template has one). `params` is `template.json` `params` with the brand's `templateParams[<templateId>]` replacing whole
top-level keys (`effectiveParams` in `src/services/fields.js`), so a workspace can change a template's wording without
copying the template; `computed` functions see the same params. Everything printed must come from the brand, `params` or the values: no literal organisation data.

## body.md

A Markdown body filled with `fillMarkdown(body, values)` (`src/render/md/fill.js`): `{{path}}`,
`{{#each list}}…{{/each}}` with `{{this}}`, `{{this.x}}`, `{{@index}}` (0-based) and `{{@index1}}` (1-based), and
`{{#if path}}…{{else}}…{{/if}}` (empty lists/objects, `''`, `0` are false). Names inside `each` resolve against the item
first. A section tag alone on its line removes that line. Nothing is escaped. Missing values print as empty text and
are returned in `missing`; unbalanced tags throw `TEMPLATE_SYNTAX` with the line number.

Named bodies: `body.<name>.md` (name: lowercase letters, digits, `-`, `_`) next to `body.md`. When the resolved values
have a string field `variant` naming one, that body is filled instead of `body.md` (`bodyFor` in
`src/services/generator.js`); any other value, or none, uses `body.md`. The filled body is also passed to the module as
`env.markdown`, so a `renderPdf` / `renderHtml` template can draw it its own way (the MoU does).

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
| spacer | `{ type: 'spacer', size }` (points; a page break when it does not fit) or `{ type: 'spacer', lines }` (pdfkit `moveDown(lines)` in the current font, no break check) |
| divider, pageBreak | `{ type: 'divider' }`, `{ type: 'pageBreak' }` |
| custom | `{ type: 'custom', name, data }`: PDF calls `pdfCustom[name]`; HTML inserts `data.html` as given (escape what you put there) or `data.text`; Markdown uses `data.md` or `data.text` |

Any block may carry `cover: true`, and `style` (PDF only): an object deep-merged over the style of its type for that
block (`{ type: 'paragraph', text, style: { moveDown: 1.2 } }`; a heading takes `heading.<level>` keys, a bullet list
the `bullets` keys plus `paragraph` for its text, a signature `{ block: { seal: null } }`).

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

## Generating documents

`src/services/generator.js`:

- `previewDocument(ctx, templateId, input, { brandId })` resolves the fields; with anything missing or invalid it
  returns `{ ok: false, missing, errors }`. Otherwise it renders every rendition as a draft and writes them to
  `<dataDir>/previews/<token>/preview.{pdf,html,md}`, returning `{ ok: true, token, renditions: [{ kind, path, bytes }], warnings }`.
  The token is a sha256 over the template hash, the canonical JSON of the input (keys sorted) and the brand's config
  hash. A preview writes no document, number, blob or audit row (loading a template still upserts its registry row).
- `generateDocument(ctx, templateId, input, { brandId, status = 'Draft', documentId, force })` creates a numbered document
  with version 1 and returns `{ documentId, number, versionNo, renditions: [{ kind, sha256, filename, bytes }] }`.
  Missing fields fail with `FIELDS_MISSING` (`details.missing`), bad values with `FIELDS_INVALID`; input values JSON
  cannot carry (BigInt, functions, NaN, Maps…) and relation fields naming a missing or hidden document are refused before
  anything is rendered. With `documentId` (a document generated from the same template and brand) it adds the next
  version and keeps the number (the result also carries `warnings`). Only a Draft document can be regenerated: a Sent, Signed or Paid one fails with
  `STATUS_LOCKED` (generate a new document and supersede the old one) unless `force: true` is passed, which resets it to
  Draft, or keeps its current status when `status` names it, and records the reset in the audit log. On regeneration
  `status` may only be Draft (or, with `force`, the current status).
  Generations of the same series in one process are queued, so they never race for a number; `NUMBER_CONTENDED`
  (after 3 re-renders) only happens when other processes keep taking the number.
- `renderRenditions(ctx, template, values, { brand, number, draft, creationDate })` renders without touching the
  database; the returned array has a `warnings` property.
- `warnings` (preview and generate): one `{ code: 'PLACEHOLDER_EMPTY', name, message }` per body placeholder that had
  no value and printed as empty text (`name` is the placeholder path, e.g. `partnerSignatory.name`). Generation still
  succeeds; the UI and the MCP agent show them. Guard optional values in a body with `{{#if path}}…{{/if}}` (an `#if`
  test never warns).

What the generator fills in:

| Document field | From |
|---|---|
| number | series `numbering.series`, or `brand.series[<templateId>]` when it is `"brand"`; date = `values.date`; `{CLIENT}` = `values.clientCode`, else the party's `attrs.code`; `{CODE}` = `values.numberCode` (else `values.code`) |
| party | the first field whose value is an entity of kind `partyKind` (party type `partyType`) |
| engagement | the first field whose value is an entity of kind `engagement`; without one the document's engagement is left as it is (a regeneration keeps one set by hand). An engagement with `engagement_of` relations must belong to the party, else that field is invalid (`FIELDS_INVALID`, or `errors` in a preview) |
| amount | `values.total` (minor units) in the locale's `currencyCode` |
| date | `values.date` |
| title | `<template title> - <party name>` |
| sensitivity, type | the template's |
| issuing brand / entity | the brand; the `company` entity linked to that brand, if any |
| document entities | `party`, `signatory` (an entity field named `signatory`, else the person entity named like the brand signatory), `issuer` |
| relations | `generated_from` -> `template:<id>@<version>` (attrs: template id, version, hash, source); each `relations` entry links to the document id held in its field (`optional: false` makes the field required) |
| version input | the canonical JSON of the input |

Templates see `values.number` and `env.number` (null in a preview and for unnumbered templates) and `env.draft`
(true only in a preview). `env.draft` is the switch for printing DRAFT: print `env.draft ? 'DRAFT' : values.number ?? ''`,
never `values.number ?? 'DRAFT'`, so a final document of an unnumbered template does not say DRAFT. A `body.md` is
filled with `number` = `DRAFT` in previews and `''` when a final document has no number (use `{{#if number}}`). Preview PDFs carry the vector watermark
`DRAFT — NOT NUMBERED` on every page. Final renditions use `creationDate` = now. Blocks templates are drawn with the
letterhead, the blocks and the footers; a `renderPdf` template draws everything itself (the generator only adds the
draft watermark and finalises the file). HTML renditions are standalone (fonts and images embedded).

## Built-in templates

### Invoice family: `invoice`, `debit-note`, `receipt`

Three thin configs over one frame (`src/render/pdf/invoiceFrame.js`, shared module exports in
`src/render/invoiceTemplate.js`): the legacy invoice page (docs/DISCOVERY.md A8 §1, layout profile `invoice`), checked
against the legacy invoice, IGST, auto-height, debit-note and receipt scripts (same text positions, pixel-identical
pages when given the same strings). The frame builds one model from the values, params and brand and draws it as PDF
(`renderPdf`), standalone HTML (`renderHtml`, CSS in pt with the frame's sizes and colours) and Markdown (`blocks`,
used only for the Markdown rendition).

What is printed, and from where:

| Part | Source |
|---|---|
| title, number and date labels, party and from headings, column labels, subtotal and total labels | `params` (`title`, `numberLabel`, `dateLabel`, `partyLabel`, `fromLabel`, `columns`, `subtotalLabel`, `totalLabel`) |
| number | `values.number` (`DRAFT` in previews) |
| bill-to | `billTo.name` (default `client.name`), `billTo.address` (default `client.attrs.address`; list of lines or text) |
| from | brand `legalName` (upper-cased unless `params.uppercaseFromName: false`), `addresses.business`; contact lines GSTIN (the brand registration labelled `params.taxIdLabel`), Phone, Email, Website from the template contact (`billing`) falling back per key to `default`; a line is left out when the brand has no value |
| item table | `items[]`; the `index` column numbers rows, `amount` is formatted `₹ 1,234.00`, other columns read the item key and fall back to the column `default` (interpolated with the brand: the invoice HSN column uses `{tax.defaultHsn}`, debit note and receipt print `—`) |
| calc rows | subtotal, then one row per rate of the chosen `taxMode` (`brand.tax.modes`, labels from the brand) |
| left panel | bank details (`params.showBank`, account chosen by `bankAccount`: account number or index, default the first; `params.bankFields`, `bankLabels`) or, for the receipt, the acknowledgement panel (`params.acknowledgement.{title,text}`, overridable by the `acknowledgement.title` / `acknowledgement.text` fields; `{amount}`, `{amountWords}`, `{party}` are filled in) |
| signatory | `signatory` field (default `brand.defaultSignatory[<templateId>]`): compact signature image h45, "FOR …" from `brand.strings.forCompany`, name and title upper-cased; `seal: true` adds the brand seal |
| declaration, thank-you | `brand.strings[params.declarationString]` (`invoiceDeclaration`, `debitNoteDeclaration`, `receiptDeclaration`), else `params.declaration`; `brand.strings.thankYou` |

Variants: `rowHeight` (field or param): a number of points (legacy 44, 70, 105; debit note 24, receipt 34) or `"auto"`
(invoice default: `max(44, description height + 24)`; the padding is 2 × the template's row text offset
`frame.table.row.textDy`, so `"auto"` gives `+ 24` on the invoice and receipt (12) but `+ 14` on the debit note (7), always
at least `frame.table.row.minHeight` 44); `descriptionWeight` `Medium` or `Bold`; `params.frame`
deep-merges over `INVOICE_FRAME_DEFAULTS` (every offset, size and colour; the debit note and receipt use it for the
CW-100 meta inset, row text offsets, the `#cbd5e1` table rule, the receipt's 8 pt table and its +6 start for
descriptions over 40 characters). A bad `rowHeight` or `bankAccount` is a field error (computed field `layout` /
`bank`).

Amounts are minor units throughout. `computed:totals` (`invoiceTotals`): tax is charged on the subtotal, total tax =
round half up (subtotal × sum of the mode's rates); it is split over the rates in proportion, each share but the last
rounded half down and the last taking the remainder, so the lines add up to the total tax and an odd paisa goes on the
last line (CGST 17.46 / SGST 17.47 for 34.93, as in the legacy invoices). `total` (the document amount) is
`totals.total`. Debit note and receipt set `params.taxable: false` (no tax lines).

Relations: `debit-note` field `invoice` (a document id) -> `adjusts`; `receipt` field `references` (a list of document
ids) -> one `pays` relation per invoice or debit note. Numbering uses the brand `series` map (`invoice`, `debit-note`,
`receipt`), which in the example brand all count on `invoice-main`.

Rows that do not fit above the signatory and declaration zone continue on a new page with the table header repeated,
and the summary or signatory move to a new page when they would overlap the declaration; the legacy scripts were
single-page only. Every continuation page repeats the logo, title, number and date (and the table header when rows
continue), so a page on its own identifies the document; the declaration and thank-you strip are on the last page.
The HTML signature image's alt text is `params.signatureAlt` (`{name}` = the signatory; default `Signature of {name}`).

### Letter family: `offer-letter`, `internship-offer`, `internship-certificate`, `experience-certificate`, `relieving-letter`

Block documents (layout profile `letter`, contact `hr`, party a `person` entity) built by `src/render/letterTemplate.js`
and drawn as the legacy letters (docs/DISCOVERY.md A8 §2-4): letterhead, `renderBlocksPdf` with the template's style,
footers. Checked against the legacy offer letter (with and without the seal), internship offer and certificate scripts
fed the same wording: identical text positions, image boxes and pixel-identical pages. The shipped wording is neutral
English and lives in `params`; nothing is hard-coded.

| Template | Pages | Numbering | Seal default |
|---|---|---|---|
| `offer-letter` | page 1 (date right at `MT+CP+20`, "To," at `+45`, name, address, centred subject, salutation, opening paragraphs), page break, terms with numbered clauses, page break, Annexure 1 (earnings, deductions, summary, notes), page break, acceptance and signature | none unless `brand.series['offer-letter']` is set | on |
| `internship-offer` | as the offer letter without the annexure; body lineGap 4, paragraphs 0.7 apart, clause headings kept with 45 pt | none unless mapped | off |
| `internship-certificate`, `experience-certificate`, `relieving-letter` | one page: `Ref:` left and `Date:` right at `MT+CP+25` (Bold 9.5), title (ExtraBold 14, centred), salutation, paragraphs (10 / lineGap 5, 1.2 apart, 2.2 before the signature), signature (image h50) | `brand.series[<id>]`, `hr-cert` in the example | on (experience fixture shows off) |

Footers: the brand footer (contact, `Confidential`, `Page n of N`) on the offer family; certificates leave out the
centre text (`Page 1 of 1`). `params.footer` and `params.style` (deep-merged over the template style, e.g.
`{ "heading": { "2": { "breakMin": 45 } } }` for the older offer-letter variant) adjust them.

Params (all text is interpolated: brand keys such as `{legalName}`, `{contact.email}`, `{company}`, `{currency}`, every
field formatted for print (`{joiningDate}` as `1 September 2026`, money as `₹10,000` with `{stipendWords}`, entities by
name, lists of lines joined by line breaks), `{fullName}` (honorific + name), `{firstName}` (the `salutationName`
field, else the first word of the name), `{number}`; offer letter also `{ctcMonthly}`, `{ctcAnnual}`,
`{ctcMonthlyWords}`, `{ctcAnnualWords}`):

| Param | Used by | Meaning |
|---|---|---|
| `refLabel`, `dateLabel` | all | `Ref: {number}` (printed only for a numbered template; `DRAFT` in its preview), `Date: {date}` |
| `toLabel`, `subject` (+ `subjectUppercase`, default true), `salutation` | offer family | page-1 head |
| `opening`, `openingMoveDown` | offer family | opening paragraphs (1.2 lines apart) |
| `termsTitle`, `clauses`, `numberClauses` | offer family | `[{ title, paragraphs?, bullets?, bulletsFrom?, after?, when?, unless? }]`; titles numbered `1.`, `2.` …; `bulletsFrom` names a list field (`responsibilities`, `documents`) that replaces `bullets` when given; `when` / `unless` name values that must be set / empty (`probation`, `stipend`, `jurisdiction`) |
| `annexure` | offer letter | `{ title, earnings: { columns, widths, totalLabel }, deductions: { title, columns, widths, rows }, summary: { title, columns, widths, rows }, notes }` |
| `acceptance` | offer family | `{ title, paragraphs, fields, closing, gaps: { afterParagraphs 0.4, afterFields 0.6, beforeSignature 1.2 } }` |
| `title`, `salutation`, `paragraphs`, `closingMoveDown` | certificates | heading and body |
| `signature` | all | `{ forLine: "For {legalName}", lines: ["Authorized Signatory"], noSealOffsets }` |

Paragraph items are text or `{ text, when?, unless?, align?, moveDown? }`. Fields: the person (`employee` / `intern`),
`recipient.name` and `recipient.address` (from the person's `attrs.address`), `honorific`, `salutationName`, `date`,
`designation` (from `attrs.designation`), the dates of the letter, `seal` (boolean) and `signatory` (default
`brand.defaultSignatory[<templateId>]`, else `letter`). Offer letter: `joiningDate`, `probation` (boolean) and
`probationPeriod`, `noticePeriod`, `workingHours`, `workingDays`, `placeOfWork` (lines, default the brand's business
address), `governingLaw`, `jurisdiction`, `confidentialityPeriod`, `acceptanceDays`, `responsibilities`, `documents`,
`earnings` (`[{ label, monthly, annual? }]`, annual default 12 × monthly; `computed:salary` sums them in paise; amounts
print without paise when every figure is whole), `deductions` (`[{ label, value }]`). Internship offer: `startDate`,
`endDate`, `stipend` (empty: unpaid, the stipend paragraph and clause are left out), `reportingTo`, `placeOfWork`.
Certificates: `startDate`, `endDate` (relieving letter: `relievingDate`), `summary`, `department` (experience),
`reason` (relieving). `opening`, `clauses` and `paragraphs` fields replace the params for one document.

### Statements: `employee-final-settlement`, `ticketing-settlement-statement`, `client-final-settlement`, `remittance-statement`, `expense-statement`

Absolutely positioned legacy pages (docs/DISCOVERY.md A8 §6b, §7, §7b, §8, §10) drawn by
`src/render/pdf/statementFrames.js` from a model built in `src/render/statementTemplate.js` (shared module exports:
`computed`, `blocks` for HTML and Markdown, `renderPdf`). Checked against the six legacy scripts of those sections (both ticketing variants) fed the
same values and wording: identical text items, image boxes and pixels. Every offset, size
and colour is in the template's frame (`EMPLOYEE_SETTLEMENT_FRAME`, `TICKETING_FRAME`, `CLIENT_SETTLEMENT_FRAME`,
`REMITTANCE_FRAME`, `EXPENSE_FRAME`), which `params.frame` deep-merges over; `params.footer` passes options to the footer.
All amounts are paise; text params are interpolated like the letter family (`{company}`, `{companyUpper}`, `{currency}`,
fields formatted for print, `{number}`), plus the computed values named below.

| Template | Profile, contact, party | Numbering | Layout and computation |
|---|---|---|---|
| `employee-final-settlement` | `letter`, `hr`, a `person` | none unless mapped (`Reference:` cell) | title at letterhead rule + 16, meta grid (rows 24 apart, columns ML / +115 / +305 / +390), boxed tables Salary Details, Deductions, Final Salary Calculation (header h28, rows h26, value column 150), net box h50, optional declaration, signature row at y 755 (signatory image h46 over "Authorized Signatory", the date over "Date", "Employee Signature"). Per-day = `monthlySalary / workingDays`, half-day = per-day / 2 (half up); `attendance[]` `{ label, days, rule: half\|full }` × rate; `deductions[]`, `additions[]` `{ label, amount }`; `total` = net. A table that would reach the signature row moves to a new page. |
| `ticketing-settlement-statement` | `settlement`, `billing`, a `client` | none unless mapped (`Doc No.:`) | title and meta (Event, Issued To, Issued By / Doc No., Date, Page No.) drawn on every page in a post-pass; content from `MT+CP+125`; slate section bars; ticket table (`columns`, or `eventColumns` when any ticket has an `event`; rows without an event continue the event's shading); platform charges card (`feePercent`, `gstPercent` default 18); final box; acknowledgement text and sign-off fields (`acknowledgement.fieldSpacing` 42 / `breakMin` 190; the older variant used 24 / 110). Revenue = sold × price; fee = `feePercent` of gross and GST = `gstPercent` of the fee, each rounded half up to a paisa (`percentOf`); net = gross - fee - GST, or gross when `deductCharges: false`. |
| `client-final-settlement` | `letter`, `billing`, a `client` | `brand.series` (`settlement`: `FSS/{CLIENT}/{YYYY}/{###}`, `{CLIENT}` from the `clientCode` field, default the client's `attrs.code`) | title and meta on page 1; Event Details (`detailRows` params with `{event}`, `{services}`, `{eventDates}`, or the `details` field), Professional Service Fee (fee, GST, total, advance in brackets, balance), a forced page break (`breakBeforeExpenses`), Reimbursable Expenses, Final Settlement Summary, total box with `{totalWords}`, settlement note (`note`, items with `when`), footnote at `PH-MB-40` on the last page. `invoices` (document ids) -> `settles`. |
| `remittance-statement` | `letter`, `billing`, a `client` | none unless mapped (`Ref:` left of the date) | date at `MT+CP+14`, salutation, subject, `paragraphs` (10 / lineGap 7, `**bold**`), transaction rows (`detailRows`; empty values left out), receiving account (`account` field rows), closing, signature (image trimmed, h46; seal by the `seal` field); footer centre in caps. `{amount}` prints `₹5,00,000` + `amountSuffix` (`/-`). `references` -> `pays`. |
| `expense-statement` | `letter` (letterhead 8 / 7.5, footer 7), `billing`, a `client` | none unless mapped (`Ref:` on the date line) | title, date right, To + recipient, subject, salutation, `opening` paragraphs (left-aligned runs, lineGap 6), bordered expense table (`items[]` `{ particulars, calculation, amount }`, total row), amount in words, `closing` paragraphs, Bank Details (the brand account chosen by `bankAccount`, or the `bankDetails` field), sign-off (image h44, name, title, `signOff.lines`). |

The `engagement` field (optional, `entity:engagement`) of the client-facing statements fills the event name and is
stored as the document's engagement.


### Agreements: `mou`

A Markdown-bodied memorandum of understanding (layout profile `mou`, 45/50/50, no letterhead; category `agreement`,
party a `client`, numbered by `brand.series.mou` when mapped, `Reference: {{number}}` in the cover). Two bodies ship,
written fresh with neutral clauses: `body.md` (variant `organisation`, a framework for all of the partner's events)
and `body.event.md` (variant `event`, one event), chosen by the `variant` field. A workspace replaces the text with its
own `templates/mou/body.md` / `body.event.md` and keeps the layout (see "Workspace overrides that inherit").
**Override both bodies:** an override with only `body.md` changes the organisation variant; documents generated with
`variant: "event"` still use the shipped neutral `body.event.md`. The
Markdown rendition is the filled body; the PDF (`src/render/pdf/mouFrame.js`) and HTML (`src/render/mouTemplate.js`)
draw `parseMarkdownBlocks` of it. The PDF is the legacy v2 MoU (docs/DISCOVERY.md A8 §12), checked against the legacy
organisation and event scripts fed the same filled body: identical text positions and pixel-identical pages (the
event script never printed signature values; this one does when the body gives them).

| Part | Layout (`MOU_FRAME`, deep-merged with `params.frame`, then `params.variants.<variant>.frame`) |
|---|---|
| cover (blocks before the first `---`) | h1 `ExtraBold 18` centred, h2 `Bold 13 #1e293b` centred, paragraphs 10.5 / lineGap 5.6: justified when they wrap or contain one of `cover.justifyContaining` (`Party`), else centred |
| headings | h1 `ExtraBold 14.5 #0f172a` lineGap 2 (0.25 / 0.28 lines), h2 `Bold 12 #1e293b`, h3 `SemiBold 11 #334155`; an h1 starts a new page unless `keepTogether[<text it contains>]` points remain (ORGANISATION DETAILS / EVENT DETAILS 450, WITNESS 260, DATA & PLATFORM USE 160, else 65) |
| paragraphs, lists | 10.2 `#334155` lineGap 5.6, justified (normal spacing when the gap exceeds 2.2 spaces or the line has `__`), bold `#0f172a`, words starting with the currency symbol `ExtraBold` +0.5; bullets `•` `SemiBold #475569` at ML+4, text at +14, lineGap 5.4, items kept whole; numbered items as bullets with `1.` |
| tables | two columns: `[135, rest]` when the first header contains `particular`, else `[rest, 130]`; more columns share the width; header `Bold 9.8` white on `#1e293b`, rows `Regular 9.3` auto height (pad 8 / 6.5, min 22) on `#fff` / `#f8fafc`; rows containing one of `table.strong.patterns` (`amount received`, `net`, `final amount`) as whole words, any case
(so `net` matches "Net amount" and "(Net)" but not "Internet" or "Network"), bold on `#f1f5f9` with a `#94a3b8` rule; closing rule `#cbd5e1` 0.75 |
| signatures | every `## For …` section is a card; cards are drawn two per row after the body (`CW/2-10` wide, gap 20, h188 r5 `#f8fafc` / `#e2e8f0`; the event variant h205): title `Bold 10`, rule, `Authorized Signatory` `Bold 9.5 #475569`, sign line 128, then `signature.fields` (`Name`, `Designation`, `Date`, `Seal`; event adds `Contact`) — a `Label: value` line in the section prints the value (`SemiBold 8.5`), an empty or `___` value leaves a ruled line |
| footer | rule `#e2e8f0` at `PH-34`, `Page {page} of {pages}` `Regular 7.5 #64748b` right (`footer.left/center/right`) |
| watermark | the `watermark` field (default off) prints `params.watermark.text` (`DRAFT — DO NOT SIGN`) Bold 38, opacity 0.14, -30°, three rows per page (`params.watermark` also takes `size`, `opacity`, `angle`, `rows`, `color`) |

Fields: `partner` (client entity; name, `attrs.address`, `attrs.registration`, `attrs.email`, `attrs.phone` fill
`partnerName`, `partnerAddress`, `partnerRegistration`, `partnerEmail`, `partnerPhone`), `partnerKind` (with its
article), `partnerContact`, `partnerSignatory` (`{ name, designation, contact }`), `engagement` and `event.name` /
`event.type` / `event.dates` / `event.venue` (`event.name` defaults to the engagement's name via `computed:eventName`;
the event variant without one is an error on `event.name`), `service`, `date`, `feePercent`,
`gstPercent` (18), `examplePrice` (1000, the fee illustration), `payoutDays` (7), `term`, `noticeDays` (30),
`governingLaw`, `jurisdiction`, `signatory` (default `brand.defaultSignatory.mou`), `watermark`. `computed:print`
gives the bodies printable strings: `print.date` (long), `print.company`, `print.companyUpper`,
`print.companyRegistration` (the brand registration labelled `params.registrationLabel`, default `CIN`, else the first),
`print.companyAddress` (registered address, else business, on one line), `print.partner`, `print.partnerUpper`,
`print.partnerAddress`, `print.feePercent`, `print.gstPercent` and `print.example.{price,fee,gst,total,received}` (fee
and GST rounded half up to a paisa). `partnerAddress` is required; `print` is a field error when the brand has neither
a registered nor a business address, or the illustration inputs are invalid, so legal text never prints a blank
address or empty fee cells. The shipped bodies guard every optional value (registration, contact, phone, email,
event type/dates/venue rows, the partner's signature values) with `{{#if}}`.

### Resolutions: `board-resolution`

The legacy board resolution (docs/DISCOVERY.md A8 §11; `src/render/boardResolutionTemplate.js`, layout profile
`letter`, letterhead, category `resolution`, no party), checked against the legacy script fed the same wording:
identical text positions and pixel-identical page. Title `ExtraBold 15` centred with letter spacing 1 at `MT`; date
`SemiBold 9.5` right (`Ref: {number}` left on the same line when the brand maps a series); preamble `Bold 9.5`
justified lineGap 5; `RESOLVED:` `ExtraBold 10.5` underlined; resolution paragraphs `Regular 9.5` lineGap 5 (1.1 lines
apart); a director list after a paragraph with `directors: true` (bullet at ML+12, name `SemiBold` at ML+26, signature
rule from ML+340 to the margin, rows 40 apart); the certification block (kept whole: 125 pt) with the title, the "For"
line and columns `(CW - 2·24) / 3` wide: the certifying directors (name `SemiBold 9.5`, role `Regular 8.5`) and the
company seal column last; footer with only the centre slot (the brand's `footer.center`, `params.footer` sets `left` /
`right` to empty).

Params (interpolated with the brand plus `{company}`, `{companyUpper}`, `{address}`, `{addressUpper}`, `{date}` in
`params.dateStyle` (`short`, DD/MM/YYYY), `{bank}`, `{number}`): `title`, `dateLabel`, `refLabel`, `preamble`,
`resolvedLabel`, `resolutions` (`[{ text, directors? }]`, default: open and operate a current and a merchant account),
`certification` (`title`, `forLine`, `sealTitle`, `sealSub`), `footer`, `frame` (`BOARD_RESOLUTION_FRAME`). Fields:
`date`, `address` (default the brand's registered address), `bank`, `directors` (`[{ name, role }]`, required),
`certifiers` (director names; default the first two), `resolutions` (replaces the params list for one document).
