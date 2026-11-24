# Build log

This is the record of how Dossier was built: what was done, in what order, how each piece was checked, the decisions taken along the way, the incidents, and what is left. It is written for the repository owner and for anyone picking the project up later.

Organisation-specific details are deliberately left out. The app was built to replace a private set of hand-written PDF scripts, and everything specific to that organisation lives in a private workspace outside this repository.

## Outcome

| Item | State |
|---|---|
| Features from the plan | 24 of 24 built, each reviewed |
| Built-in templates | 17 |
| Tests | 569 passing (`npm test`) |
| Organisation-data guard | 0 hits across the shipped tree |
| Fidelity against the legacy PDFs | 16 of 16 comparable templates within 0.5 pt on every fixed label and image |
| Branch | `main`, pushed; history rewritten once (see below) |

## How the work was run

1. **Learn.** The legacy folder was explored read-only. Its findings are in `docs/DISCOVERY.md`: generation style, every document type and field, assets, exact layout values, numbering formats and the vault spec.
2. **Plan.** `docs/PLAN.md` covers the architecture, data model, hierarchy, metadata, relations, rules, search, generator, MCP tools, cache layers, testing and build order. It was approved before any code was written.
   - The owner then asked for a public, fully customisable app. The plan gained a workspace layer (B0, B14), so no organisation data lives in the code.
3. **Build.** Every feature went to a separate implementer agent (Claude Opus 5.5) with a written brief. A fresh reviewer agent then checked each one, first against the spec and then for code quality.
   - Any Critical or Important finding went back to the implementer, followed by a scoped re-review.
   - Minor findings were logged and triaged at the end.
   - Each feature was committed with a `type(scope): summary` message and pushed once its review was clean.
4. **Final review.** One whole-branch review covered security, data integrity, organisation-agnosticism and consistency across templates. A single fix wave followed, then a scoped re-review.

## Features in build order

Commit IDs are those after the history rewrite.

| # | Feature | Commits | Review rounds |
|---|---|---|---|
| 1 | Scaffold, planning docs, test setup | 3dc97b8 | done by the coordinator |
| 2 | Workspace loader, brand/series/seed schemas, example workspace, placeholder images | 44cf79c | clean |
| 3 | SQLite schema, migrations, repo layer, audit log, context | 8cbc0e3, bd5abf4 | 1 fix round: rollback on older Node, post-commit listener errors |
| 4 | Entities master list with canonical names, aliases and relations | 632803f | clean |
| 5 | Vault core: blobs, documents, versions, renditions, status, sensitivity | 34eff9d, 1fb446e | 1 fix round: gated file reads |
| 6 | Upload with text extraction and checksum dedupe | e63be8b | clean |
| 7 | Folder tree generated from metadata | 7d2f7ef, 797edbc | 1 fix round: leaf sets per folder, Restricted placement |
| 8 | Search across metadata, text and one-hop relations | 532405a, fe9452b | 1 fix round: punctuation-only queries |
| 9 | Numbering engine with shared counters | 6762850, f040b23 | 1 fix round: chained counters |
| 10 | PDF layout primitives ported from the legacy scripts | 4489879, 2e5df59, adacc56 | 1 fix round: neutral comments, option defaults |
| 11 | Template registry, field resolution, block, HTML and Markdown renderers | 1af8ab9, 37f4e6e, e93a6a2 | 2 fix rounds: money scaling, blank inputs |
| 12 | Generator: unnumbered previews, numbered finals | c6d96d4, bf10005 | 1 fix round: locked statuses, no "DRAFT" on finals |
| 13 | Invoice, debit note, receipt | 0e569fa, c1c576f | 1 fix round: page-overflow estimate |
| 14 | Offer letters, certificates, relieving letter | 1f01670 | clean |
| 15 | Settlement, remittance and expense statements | b46815e, 1703f0b, bd2af1b | 1 fix round: engagement handling |
| 16 | MoU and board resolution, workspace template inheritance | e1197b5, ded173f, 52bf969 | 1 fix round: blank placeholders in legal text |
| 17 | Proposal and pricing report, per-code quotation counters | f58cd7c, 53c5885, eb26104 | 1 fix round: contents overflow, wording |
| 18 | Web UI: browse, search, upload, generate | 092eb10 | clean |
| 19 | Web UI: brand, asset and series settings | 07b96bf, 9df535e | 1 fix round: clearance-guard bypass |
| 20 | MCP server for Claude Code | 23d3935, 1b59782 | 1 fix round: strict tool arguments, clearance wording |
| 21 | Cache layers: memo, render cache, search cache, HTTP headers | 1d30c60 | clean |
| 22 | Legacy folder import | 6a17eb1, 10cda5a, 09acf84, 155d0bf | 2 fix rounds: Restricted and secret skipping, CSV root |
| 23 | Samples, visual checks, organisation-data guard, full docs | ff98cf3, 9335764, 3ae9c2f, f8109b4, b934c3c | 1 fix round: guard coverage |
| 24 | Private workspace and fidelity comparison (outside the repo) | 5ab56d3, 1b122ed | clean |
| — | Final review fix wave | a4a9968, ba1a85f, f6a55f5, 8b5b028, 5b9ed66, adc02c0, 85d51ea | 1 re-review |

## What the final review fixed

- **Real names in two docs.** `docs/DISCOVERY.md` and `docs/PLAN.md` still contained organisation and personal names; only identifier numbers had been removed. Both were rewritten with neutral labels. The guard now scans them too, along with `bin/`, `package.json` and e-mail domains.
- **Reused numbers.** The generator could issue a number an uploaded document already held. Allocation now skips used numbers inside the transaction, and uploads and edits seed the counters.
- **Stale links on regenerate.** Regenerating no longer keeps relations the new input dropped.
- **Opaque template errors.** Errors inside template code now come back as `TEMPLATE_RENDER_FAILED`, a clear 4xx error, not a bare 500. Impossible dates give `INVALID_INPUT`.
- **Open binding.** The server refuses to bind beyond loopback unless `DOSSIER_ALLOWED_HOSTS` is set.
- **CSS escaping.** One CSS escaping gap was closed.

## Rulings made during the build

These decisions were taken without asking the owner. Each one notes what it costs if it was wrong.

1. **One MoU template** with an organisation/event variant instead of two templates. If wrong, splitting it later is easy.
2. **Built on `main`.** The repository was empty, and the brief asked for a commit per feature. No cost.
3. **Hyphens kept** in canonical-name matching. Hyphen and space spellings of a name need a manual alias.
4. **Two small vault changes made early** because later work depended on them: blob writes outside the database lock, and the first version always made current. A little extra work.
5. **Pushed after each reviewed feature** once the owner asked to publish. No cost.
6. **Regenerating a Sent, Signed or Paid document needs `force`.** Superseding is the normal path. Callers must pass `force` deliberately.
7. **Tax split follows the legacy scripts:** the odd paisa goes on the last tax line. No cost.
8. **Per-workspace wording goes in `brand.templateParams`**, because copied template code could not import the shared modules. No cost.
9. **Fees round exact half-paise up.** The legacy scripts used floating-point maths instead. About 0.2% of prices differ by one paisa from old PDFs.
10. **Quotation numbers keep one counter per client code** (scope `brand+year+code`), matching the legacy numbering. No cost.
11. **The "Restricted" folder check was widened before the real-tree dry run.** One extra fix round.
12. **The guard briefly excluded DISCOVERY and PLAN.** This was wrong, and the final fix wave reversed it (rulings 14 and 15).
13. **Task 24 was the only work allowed to write outside the repo**, and only into the private workspace folder. No cost.
14. **DISCOVERY and PLAN were rewritten with neutral labels.** Full versions are kept privately. The public docs are less specific.
15. **Git history was rewritten** on the owner's instruction (below).

## Incidents

- **A pre-existing folder outside the repo was deleted.** An agent used a browser tool to check the web UI. The tool wrote into a folder that already existed in the parent directory, and the agent then deleted that whole folder, believing it had created it. It held about 260 older browser-session files: page snapshots, console logs and a few screenshots. It could not be recovered: there was no Trash copy, Time Machine, or usable local snapshot. After this, every agent ran under two rules: no browser tools, and no deleting, moving or overwriting anything outside the repo.
- **`node_modules` vanished during a test run.** No tracked file was lost, and the cause was not found. Dependencies were reinstalled from the lockfile with `npm ci`. Agents were then also barred from running install commands.
- **A stray file was written outside the repo.** An agent copied a repo script to a temporary path outside its allowed temp folders. The file contains only Dossier code. The owner was told so they could remove it.
- **Real asset copies were left in a session scratch folder.** Two legacy-replay checks copied real logo, seal and signature files into the session's scratch folder. The owner was told so they could remove them.

## History rewrite

At the owner's request, all 58 commits were rewritten and force-pushed:
- Every past version of the two planning docs was replaced with its neutral version.
- One source comment and one fake test value that referred to real names were neutralised.
- One commit message was reworded.

The final file tree is byte-identical to before. A scan of every commit and commit message for the replaced names finds nothing.

The owner holds a private backup bundle of the old history; it should be deleted once no longer needed. GitHub may keep serving old commits by ID until a cache purge is requested from GitHub Support. Clones made before the rewrite still hold the old history.

## Private workspace (not in this repo)

The owner's organisation runs Dossier from a private workspace folder next to the repo. It contains:
- brands with their real constants and assets;
- numbering series that continue the legacy sequences;
- wording overrides;
- seed entities;
- sample inputs and a comparison script.

All 17 comparison samples passed against the legacy PDFs. The relieving letter had no legacy PDF to compare against. Only a dry run of the legacy vault import has been done; the real import is the owner's decision.

## Open items

These were logged during reviews and left for later. None blocks use.

- **Previews:** preview files are never cleaned up, and their tokens are content hashes rather than random secrets.
- **Web server reload:** the server does not reload hand-edited workspace files; the MCP server does.
- **Keynote uploads:** `.key` uploads are rejected as if they were secret keys.
- **Render cache:** final documents are stored but never reused unless `creationDate` is given, and the cache key does not include the Node version.
- **Preview dates:** previews are dated midnight UTC, which can show the previous day in negative-offset time zones.
- **India defaults:** money formatting uses `₹`, Lakh/Crore and `en-IN`. All are configurable per workspace, but the web views always group numbers the Indian way.
- **Layouts not rebuilt:** older proposal and report layouts and two group-entity designs.
- **Small polish items** are listed in `docs/DECISIONS.md` where a decision was recorded.

## Where to look next

- `README.md`: setup, running, testing, customising, MCP and import.
- `docs/PLAN.md`: architecture and data model.
- `docs/DECISIONS.md`: every small decision, with reasons.
- `docs/WORKSPACE.md`, `docs/TEMPLATES.md`, `docs/MCP.md`: reference guides.
