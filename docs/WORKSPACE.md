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

## Layout

```
<workspace>/
├── workspace.json            name, default brand, locale, users, hierarchy
├── brands/<brandId>/
│   ├── brand.json            one issuing entity (company, LLP, product brand…)
│   └── assets/               logo.png, seal.png, sign-<signatoryId>.png, fonts/*.ttf
├── series.json               numbering series
├── templates/<templateId>/   your templates and overrides of built-ins (same id overrides)
├── seeds/entities.json       optional initial parties, people, clients, vendors, products
└── data/                     created by the app: database, blobs, cache (never edit by hand)
```

Every file is validated when the workspace loads. Errors name the file and the field, for example:

```
brands/acme/brand.json: invalid:
  contacts: must contain a "default" contact
```

## workspace.json

| Field | Default | Notes |
|---|---|---|
| `name` | required | shown in the UI |
| `defaultBrand` | required | a folder name under `brands/` |
| `locale.currencySymbol` | `₹` | |
| `locale.currencyCode` | `INR` | ISO 4217 |
| `locale.numberLocale` | `en-IN` | used for number formatting |
| `locale.dateFormats.short` / `.long` / `.us` | `DD/MM/YYYY` / `D MMMM YYYY` / `MMMM D, YYYY` | |
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
| `contacts` | required | `{ "<key>": { "email", "phone", "website" } }`; must contain `default` (templates may ask for `hr`, `billing`…) |
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
| `strings` | `{}` | free text used by templates, e.g. `confidential`, `invoiceDeclaration`, `thankYou`, `forCompany` |
| `tax.modes` | one mode `none` | `[{ id, label, rates: [{ label, rate }] }]`, rate as a fraction (`0.09`) |
| `tax.defaultMode` | `none` | must be one of `tax.modes` |
| `tax.defaultHsn` | none | |
| `series` | `{}` | `{ "<templateId>": "<seriesId>" }`; every series id must exist in `series.json` |
| `layoutProfiles` | none | `{ "<profileId>": { …partial profile… } }` overrides of the shipped layout profiles |

Default palette:

```json
{ "ink": "#1a1a1a", "body": "#333333", "label": "#555555", "muted": "#666666", "faint": "#888888", "subtle": "#999999",
  "rule": "#e8e8e8", "ruleStrong": "#d0d0d0", "ruleFaint": "#f0f0f0", "fill": "#fbfbfb", "fillAlt": "#f8f8f8",
  "fillTotal": "#f1f1f1", "fillPanel": "#f9f9f9", "section": "#606f7b", "accent": "#1a1a1a", "white": "#ffffff" }
```

### Placeholders in strings

Strings such as letterhead lines, footer parts and `strings.*` may contain `{a.b.c}` paths, filled when a document is rendered. The brand itself is in scope (`{legalName}`, `{strings.confidential}`, `{registrations.0.value}`), plus `{contact.*}` (the contact the template uses, normally `contacts.default`) and `{page}` / `{pages}` in footers. A path that does not resolve prints as empty text. Numbering tokens such as `{####}` are not touched.

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
| `pattern` | required | literal text plus tokens: `{YYYY}`, `{YY}`, `{FY}`, `{CLIENT}` (client code), `{CODE}` (asked per document), `{#…#}` zero-padded counter (`{###}` = 3 digits) |
| `scope` | `brand+year` | where the counter restarts: `global`, `brand`, `brand+year`, `brand+year+client` |
| `start` | `1` | first number |
| `counter` | own id | share another series' counter (e.g. invoices, debit notes and receipts on one sequence) |

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
