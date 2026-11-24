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

The folder name must equal `id`. A folder that does not load (bad JSON, schema error, unknown series, no
`index.js`/`body.md`) is left out of `listTemplates` and reported by `listTemplateErrors(ctx)` as
`{ id, source, path, code, message, details }`; it never affects other templates. `getTemplate(ctx, id)` for that id
throws `TEMPLATE_INVALID` with the file and the field (`templates/offer/template.json: invalid:\n  category: …`). A
broken workspace override is not replaced by the built-in it overrides: its id fails until it is fixed.

Every listed template is registered in the `templates` table (`id`, `version`, `source` = `builtin` | `workspace`,
`path`, `hash`, `meta_json`). The hash is a SHA-256 over the bytes of `template.json`, `body.md` and every `.js` file
in the folder (sub-folders included), so editing any of them registers a new hash (audited as `template.update`).
`getTemplate(ctx, id)` returns `{ id, meta, module, body?, hash, source, path }`; `index.js` is re-imported when the
hash changes (helper modules it imports stay cached by Node until the process restarts).

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

## Generating documents

`src/services/generator.js`:

- `previewDocument(ctx, templateId, input, { brandId })` resolves the fields; with anything missing or invalid it
  returns `{ ok: false, missing, errors }`. Otherwise it renders every rendition as a draft and writes them to
  `<dataDir>/previews/<token>/preview.{pdf,html,md}`, returning `{ ok: true, token, renditions: [{ kind, path, bytes }] }`.
  The token is a sha256 over the template hash, the canonical JSON of the input (keys sorted) and the brand's config
  hash. A preview writes no document, number, blob or audit row (loading a template still upserts its registry row).
- `generateDocument(ctx, templateId, input, { brandId, status = 'Draft', documentId, force })` creates a numbered document
  with version 1 and returns `{ documentId, number, versionNo, renditions: [{ kind, sha256, filename, bytes }] }`.
  Missing fields fail with `FIELDS_MISSING` (`details.missing`), bad values with `FIELDS_INVALID`; input values JSON
  cannot carry (BigInt, functions, NaN, Maps…) and relation fields naming a missing or hidden document are refused before
  anything is rendered. With `documentId` (a document generated from the same template and brand) it adds the next
  version and keeps the number. Only a Draft document can be regenerated: a Sent, Signed or Paid one fails with
  `STATUS_LOCKED` (generate a new document and supersede the old one) unless `force: true` is passed, which resets it to
  Draft, or keeps its current status when `status` names it, and records the reset in the audit log. On regeneration
  `status` may only be Draft (or, with `force`, the current status).
  Generations of the same series in one process are queued, so they never race for a number; `NUMBER_CONTENDED`
  (after 3 re-renders) only happens when other processes keep taking the number.
- `renderRenditions(ctx, template, values, { brand, number, draft, creationDate })` renders without touching the
  database.

What the generator fills in:

| Document field | From |
|---|---|
| number | series `numbering.series`, or `brand.series[<templateId>]` when it is `"brand"`; date = `values.date`; `{CLIENT}` = the party's `attrs.code`; `{CODE}` = `values.numberCode` (else `values.code`) |
| party | the first field whose value is an entity of kind `partyKind` (party type `partyType`) |
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
(invoice default: `max(44, description height + 24)`); `descriptionWeight` `Medium` or `Bold`; `params.frame`
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
single-page only.
