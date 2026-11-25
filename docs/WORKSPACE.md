# Workspaces

Dossier keeps no organisation data in code. Names, registration ids, addresses, bank details, logos, seals, signatures, strings and numbering patterns live in a **workspace** directory that you own. The app reads it at startup.

## Create one

```sh
node bin/dossier.js init              # copies workspace.example/ to $DOSSIER_HOME or ./workspace
node bin/dossier.js init ~/my-company # or to any empty directory
export DOSSIER_HOME=~/my-company
```

`init` refuses a directory that is not empty. `./workspace/` is git-ignored; keep a private workspace outside the repository or in its own private repository.

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `DOSSIER_HOME` | `./workspace` | workspace root (relative paths resolve against the current directory) |
| `DOSSIER_USER` | OS user name | local user id; its clearance comes from `workspace.json` `users` |
| `PORT` | `4400` | HTTP port |
| `DOSSIER_TEMPLATE_DIRS` | none | extra template folders (separated like `PATH`), loaded after the built-ins and before the workspace's `templates/` |
| `DOSSIER_RENDER_CACHE_MB` | `500` | size bound of the rendered-file cache in `data/cache/render` (least recently used entries are removed first); `0` turns it off. `dossier cache clear` empties it |

## Layout

```
<workspace>/
├── workspace.json            name, default brand, locale, users, hierarchy
├── brands/<brandId>/
│   ├── brand.json            one issuing entity (company, LLP, product brand…)
│   └── assets/               logo.png, seal.png, sign-<signatoryId>.png, fonts/*.ttf
├── series.json               numbering series
├── templates/<templateId>/   your templates and overrides of built-ins (same id overrides; see docs/TEMPLATES.md)
├── seeds/entities.json       optional initial parties, people, clients, vendors, products
└── data/                     created by the app: database, blobs, cache (never edit by hand)
```

Every file is validated when the workspace loads. Errors name the file and the field, for example:

```
brands/acme/brand.json: invalid:
  contacts: must contain a "default" contact
```

## Editing in the web UI

The web app's Settings pages edit these files in place: `/settings/brands` lists and creates brands, `/settings/brands/<id>` edits one brand (tabs per section, plus an Advanced JSON tab), `/settings/numbering` edits `series.json` and `/settings/workspace` the name, default brand, locale, hierarchy and users of `workspace.json`. They use the JSON API, which scripts can call too: `GET /api/brands`, `GET/PUT /api/brands/<id>`, `POST /api/brands` (create only: an existing id is `BRAND_DUPLICATE`, 409), `GET /api/brands/<id>/assets`, `POST /api/brands/<id>/assets/<key>`, `GET /api/brands/<id>/file`, `GET /api/brands/<id>/preview.pdf`, `GET/PUT /api/series`, `GET /api/series/usage`, `GET/PUT /api/workspace`.

- Every save is checked against the whole workspace first, exactly as at startup (a series that a brand still maps, or a counter chain, is refused with the file and field named). A refused save changes nothing. Saving `series.json` is also refused when a template that loads today would stop loading.
- Files are written atomically (a temporary file in the same folder, then renamed), audited as `workspace.write` (before and after, capped at 64 KB), and the running server reloads the workspace and updates the brand's `config_hash` at once. Files edited by hand are read at startup (and with the next save from the UI). The MCP server checks the files before every tool call and reloads them when they changed (see `docs/MCP.md`).
- `PUT /api/brands/<id>` replaces the brand's own file; the brand editor keeps `layoutProfiles`, `templateParams` and keys it does not show. Changed asset paths must stay inside the brand folder (no absolute paths, no `..`) and name an existing file (upload new files instead).
- For a brand with `inheritsFrom`, the editor shows inherited values and leaves blank fields out of the file; lists (registrations, bank accounts, letterhead lines, signatories, tax modes) are written only when overridden; maps (contacts, strings, default signatories, series) hold only the brand's own keys. `inheritsFrom` itself is set when the brand is created (or in the file).
- Uploads (`logo`, `seal`, `watermark`, `signature:<signatoryId>`, `signature-large:<signatoryId>`, `font:<weight>`): images must be PNG or JPEG and fonts TrueType or OpenType, at most 10 MB (larger is `ASSET_TOO_LARGE`, 413). The file is stored as `assets/<slot>-<hash>.<ext>` (fonts in `assets/fonts/`); the uploaded file name is never used. Uploading a signature for a brand that inherits its signatories copies the inherited list into the brand first.
- `GET /api/brands/<id>/preview.pdf` renders one page with the letterhead, palette, fonts, a signature block and the footer, from the saved settings. `GET /api/brands/<id>/file` downloads the brand's own file as `<id>.json`.
- In `workspace.json` (Settings → Workspace or `PUT /api/workspace`) you cannot give any user (yourself included) a clearance above your own, and you cannot change or remove a user whose clearance is above yours. A blank clearance, a removed user and a newly listed user count as Confidential.

## workspace.json

| Field | Default | Notes |
|---|---|---|
| `name` | required | shown in the UI |
| `defaultBrand` | required | a folder name under `brands/` |
| `locale.currencySymbol` | `₹` | |
| `locale.currencyCode` | `INR` | ISO 4217 |
| `locale.numberLocale` | `en-IN` | used for number formatting |
| `locale.dateFormats.short` / `.long` / `.us` | `DD/MM/YYYY` / `D MMMM YYYY` / `MMMM D, YYYY` | tokens `YYYY`, `MMMM`, `MMM`, `MM`, `M`, `DD`, `Do` (31st), `D`; other characters are copied |
| `locale.currencyWords.major` / `.minor` / `.suffix` | `Rupees` / `Paise` / `Only` | amounts in words use the Indian system (Thousand, Lakh, Crore): `Rupees One Lakh Twenty Thousand Only`, `Rupees Ten and Fifty Paise Only` |
| `users.<userId>.clearance` | `Confidential` | `Public`, `Internal`, `Confidential` or `Restricted`; users not listed get `Confidential` |
| `hierarchy.topLevel` | built-in names | exactly 10 top-level folder names, in order |
| `hierarchy.routing` | built-in table (`src/domain/routing.js`) | `{ "<docType>": "<route>" }` overrides, type matched case-insensitively. A plain leaf name (`"Agreements"`) files the type inside the party's folder; a value starting with a top-level name (`"06 Finance/Bank Statements"`, `"08 References"`) files it in that folder (finance folders add the financial year). Overrides are used as given (built-in routes are limited to each folder's leaf set, else `Other`). The Restricted folder is not a valid target: only Restricted sensitivity places a document there |

## brands/&lt;id&gt;/brand.json

The folder name must equal `id`. Paths in `brand.json` are relative to the brand folder.

| Field | Default | Notes |
|---|---|---|
| `id` | required | lowercase letters, digits, `-`, `_` |
| `inheritsFrom` | none | another brand id. The parent's `brand.json` is deep-merged under this one: objects merge key by key, the child wins, arrays (registrations, signatories, bank accounts, letterhead lines…) are replaced as a whole. Asset files are looked up in the child folder first, then in the parent's. |
| `legalName`, `shortName` | required | |
| `registrations` | `[]` | `[{ "label": "CIN", "value": "…" }]`, any labels |
| `addresses.business` | required | lines |
| `addresses.registered` | none | lines |
| `contacts` | required | `{ "<key>": { "email", "phone", "website" } }`; must contain `default` (templates may ask for `hr`, `billing`…; a key the named contact leaves out falls back to `default`) |
| `bankAccounts` | `[]` | `[{ accountName, bankName, accountNumber, ifsc?, swift?, branch? }]` |
| `letterhead.lines` | `[]` | lines under the company name in the letter header; may use placeholders |
| `footer.left` / `.center` / `.right` | `""` | page footer; may use placeholders, including `{page}` and `{pages}` |
| `palette` | neutral palette below | any subset; extra keys allowed; hex colours |
| `fonts.<weight>` | bundled Manrope | weights `regular, medium, semibold, bold, extrabold, light, extralight`; value `builtin:<Family>-<Style>` (e.g. `builtin:Manrope-Bold`) or a `.ttf` path relative to the brand folder |
| `assets.logo` | `assets/logo.png` | |
| `assets.seal` | none (looks for `assets/seal.png`) | |
| `assets.watermark` | none | image path |
| `signatories` | `[]` | `[{ id, name, title, titleLong?, signature?, signatureLarge?, email?, phone? }]`; `signature` is the compact image (invoices), `signatureLarge` the letter-family image (falls back to `signature`) |
| `defaultSignatory` | `{}` | `{ "<templateId or category>": "<signatoryId>" }` |
| `projectContact` | none | signatory id printed as the project contact in proposal sign-offs (must be one of `signatories`) |
| `strings` | `{}` | free text used by templates, e.g. `confidential`, `invoiceDeclaration`, `thankYou`, `forCompany` |
| `tax.modes` | one mode `none` | `[{ id, label, rates: [{ label, rate }] }]`, rate as a fraction (`0.09`) |
| `tax.defaultMode` | `none` | must be one of `tax.modes` |
| `tax.defaultHsn` | none | |
| `series` | `{}` | `{ "<templateId>": "<seriesId>" }`; every series id must exist in `series.json` |
| `layoutProfiles` | none | `{ "<profileId>": { …partial profile… } }` overrides of the shipped layout profiles |
| `templateParams` | `{}` | `{ "<templateId>": { "<param>": … } }`: replaces whole top-level `params` of a template for this brand (e.g. the clause list of `offer-letter`) |

Default palette:

```json
{ "ink": "#1a1a1a", "body": "#333333", "label": "#555555", "muted": "#666666", "faint": "#888888", "subtle": "#999999",
  "rule": "#e8e8e8", "ruleStrong": "#d0d0d0", "ruleFaint": "#f0f0f0", "fill": "#fbfbfb", "fillAlt": "#f8f8f8",
  "fillTotal": "#f1f1f1", "fillPanel": "#f9f9f9", "section": "#606f7b", "accent": "#1a1a1a", "white": "#ffffff" }
```

### Placeholders in strings

Strings such as letterhead lines, footer parts and `strings.*` may contain `{a.b.c}` paths, filled when a document is rendered. The brand itself is in scope (`{legalName}`, `{strings.confidential}`, `{registrations.0.value}`), plus `{contact.*}` (the contact the template uses, normally `contacts.default`; missing keys come from `default`) and `{page}` / `{pages}` in footers. A path that does not resolve prints as empty text, except an all-uppercase name such as `{YYYY}`, `{FY}`, `{CODE}` or `{CLIENT}`, which is kept as written so numbering tokens survive. Counter tokens such as `{####}` are never touched.

### Assets and placeholders

If a referenced file is missing, Dossier uses a neutral grey placeholder from `assets/placeholders/` (`logo.png` 1027×234, `signature.png` 1024×406, `signature-large.png` 5914×4873, `seal.png` 1586×1471) or the bundled Manrope font for that weight. The example workspace ships no images on purpose, so it renders with these placeholders. Replace them by dropping your own files at the paths named in `brand.json`; images with a transparent background work best. The placeholders are regenerated with `node scripts/make-placeholders.js`.

## series.json

```json
[
  { "id": "invoice-main", "pattern": "ACM-{YYYY}-{####}", "scope": "brand+year" },
  { "id": "receipt", "pattern": "ACM-REC-{YYYY}-{####}", "scope": "brand+year", "counter": "invoice-main" }
]
```

| Field | Default | Notes |
|---|---|---|
| `id` | required | unique |
| `pattern` | required | literal text plus tokens: `{YYYY}`, `{YY}`, `{MM}` (from the document date), `{FY}` (Indian financial year, April-March, e.g. `2026-27`), `{BRAND}` (brand id), `{CLIENT}` (client code), `{CODE}` (asked per document), and exactly one counter `{#…#}`, zero-padded and never truncated (`{###}` = 3 digits, `1234` stays `1234`). Any other `{…}` is an error |
| `scope` | `brand+year` | where the counter restarts: `global`, `brand`, `brand+year`, `brand+year+client`, `brand+year+code` (one counter per `{CODE}`, e.g. quotations `ACM-Q-EISS-2026-01`, `-02` and `ACM-Q-SSP-2026-01`) |
| `start` | `1` | first number; a series that shares another's counter uses that series' `start` |
| `counter` | own id | share another series' counter (e.g. invoices, debit notes and receipts on one sequence) |

`{BRAND}`, `{CLIENT}` and `{CODE}` values are uppercased and reduced to `A-Z`, `0-9` and `-` (spaces and `_` become `-`). The year of a year-scoped counter is the calendar year when the pattern has `{YYYY}`, else the financial year when it has `{FY}`, else the calendar year of the document date; so a `{FY}` series restarts in April. `counter` must name a series that owns its counter (no chains), and a series that shares a counter must have the owner's `scope` and count by the same kind of year, otherwise the workspace does not load. `{CLIENT}` splits a counter only with scope `brand+year+client`, and `{CODE}` only with scope `brand+year+code` (which then needs a code for every number; `registerExisting` seeds the counter of the code it parses).

## seeds/entities.json

Optional. Initial entities and their relations, validated with the workspace and used to populate the entity tables.

```json
{
  "entities": [
    { "kind": "client", "name": "Example Client", "aliases": ["EC"], "attrs": { "code": "EC", "address": ["…"] } },
    { "kind": "business_line", "name": "Events" }
  ],
  "relations": [
    { "from": { "kind": "client", "name": "Example Client" }, "to": { "kind": "business_line", "name": "Events" }, "role": "belongs_to_business_line" }
  ]
}
```

Kinds: `company, group_entity, person, client, vendor, product, business_line, engagement, financial_year`. Roles: `employed_by, director_of, belongs_to_business_line, engagement_of, vendor_of, product_of, group_entity_of, signatory_of, contact_of`. A company or product that issues documents can name its `brand`. Relations must point at entities in the same file.

Names are matched after normalisation (lower case, punctuation other than `&`, `'` and `-` removed, curly quotes and dash variants unified, whitespace collapsed), so `Acme Events, Pvt. Ltd.` and `acme events pvt ltd` are the same name. Within one kind, a name or alias belongs to exactly one entity. Loading seeds is idempotent: missing entities, aliases and relations are added; existing entities are found by name or alias and their names, attrs and brand are never overwritten, so edits made in Dossier survive a re-seed.
