# Build log

This is the record of how Dossier was built: what was done, in what order, how each piece was checked, the decisions taken along the way, the incidents, and what is left. It is written for the repository owner and for anyone picking the project up later.

Organisation-specific details are deliberately left out. The app was built to replace a private set of hand-written PDF scripts, and everything specific to that organisation lives in a private workspace outside this repository.

The log covers two phases. Phase 1 (version 0.1.0) built the vault, generator, MCP server and a server-rendered UI; it is described from "Outcome" to "Open items". Phase 2 (version 1.0.0) replaced the UI with a React web app; it has its own section, "Phase 2: product UI", near the end.

## Outcome

Phase 1 (0.1.0). The phase 2 outcome is in its own section.

| Item | State |
|---|---|
| Features from the plan | 24 of 24 built, each reviewed |
| Built-in templates | 17 |
| Tests | 569 passing (`npm test`) at 0.1.0; 1,021 at 1.0.0 |
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

## Phase 2: product UI

Phase 2 turned the working app into a product. The plain server-rendered pages were replaced by a React web app with a dark theme, a sidebar, a dashboard, data tables and a command palette, and the project got a logo. The backend's business rules did not change. The result is version 1.0.0. The work ran on 24 and 25 November 2026.

### Outcome

| Item | State |
|---|---|
| Features from the plan | F02 to F24 built and reviewed, plus a `sharp` security upgrade and a final fix wave |
| Tests | 1,021 passing (`npm test`): 603 API and service tests, 418 web app tests (1,002 before the final fix wave) |
| Web app TypeScript | `npm run typecheck` clean (strict, `noUncheckedIndexedAccess`) |
| Organisation-data guard | 0 hits across the shipped tree, which now also covers `web/`, `CHANGELOG.md` and the Docker files |
| Production build | `npm run build`: no chunk over 500 kB; charts load only with the dashboard |
| Dependency audit | 0 runtime vulnerabilities (`npm audit --omit=dev`); 4 moderate ones in development-only tools |
| Old UI | removed; every removed route is listed in `CHANGELOG.md` |
| Branch | `main`; tag `v1.0.0` follows the final whole-branch review |

### How the work was run

1. **Grilling.** The owner and the coordinator settled the decisions in two rounds of questions before any planning. The decisions covered the stack, deleting the old UI, a single user with no login, the navigation, the dashboard's contents, the visual system, the logo process, each screen, the process and the testing approach.
2. **Plan.** A written plan covered the repo layout, backend changes, theme tokens, every screen and a task list (F00 to F24). The owner approved it before any code was written.
3. **Subagent-driven build.** As in phase 1, each feature went to a separate implementer agent (Claude Opus 5.5) with a written brief. A fresh reviewer agent then checked it against the spec and for code quality.
   - Critical and Important findings went back to the implementer, followed by a scoped re-review.
   - Minor findings were parked and routed to a later feature or listed below.
   - A ledger recorded every dispatch, review, ruling and incident.
4. **Parallel worktrees.** After F04 the owner asked for independent tasks to run in parallel.
   - A preparation commit first added every shared component and dependency, so feature agents never had to touch `package.json`, the lockfile, `CHANGELOG.md`, `docs/DECISIONS.md` or the README.
   - Features then ran in three batches, each agent in its own git worktree and branch.
   - The coordinator cherry-picked each reviewed branch onto `main` one at a time. It then added that feature's changelog and decision entries in a separate `docs:` commit.
   - The remaining features (F21 to F24) ran after the batches, with some overlap.
5. **Checks with the owner.** The owner picked the logo direction from three concepts (F19). They also checked the finished pages in a browser before the old UI was removed (F21). Work paused twice at the owner's request and resumed from the ledger.
6. **Final review and fix wave.** A whole-branch review (9746d11..c8d4a5c) found no Critical issues, two Important ones (whole-file settings saves could silently undo changes made elsewhere, clearance downgrades included; entity document counts ignored clearance) and eight Minor ones. One fix wave fixed all of them, each with a test. The `v1.0.0` tag is placed after it.

### Features in build order

Commit IDs are on `main`. Most features have a `docs:` commit with their changelog and decisions, listed last in the row.

| # | Feature | Commits | Review rounds |
|---|---|---|---|
| F00 | Vendor the shadcn agent skill | 06d7351 | done by the coordinator |
| F01 | Prepare the branch: changelog, `test:api`, guard paths | 4fffecd | done by the coordinator |
| F02 | Serve the web app, CSP, `GET /api/me`, `GET /api/meta` | 8dc0b10 | clean; minors carried to F21 |
| F03 | Web scaffold, theme, fonts, app shell, build wiring | 0d75ea1, 78646b8 | 1 fix round: field error details, project links from `package.json` |
| F04 | Dashboard API | 2bcf6c1, 2b86912 | approved; 1 follow-up round: one warning per brand, canonical `days` |
| — | Shared components, libraries and data table for parallel work | 8d553fa, 5512045, cfaf373 | 1 fix round: page reset, explicit server mode, shared confirm dialog |
| F19 | Logo concepts (owner checkpoint) | a9d7520, e76c63b | owner picked concept A |
| F08 | Document page (read) | b32f0d4, 63d35a5 | Review: not recorded in the ledger; merged after the controller's checks. |
| F16 | Settings API additions | 4a37828, c693bdf, 831c4ec | 1 fix round: asset routes for every slot, effective asset paths |
| F11 | Templates page | c475ce9, aca70ca, 31d1580 | clean |
| F06 | Vault tree | 7be4023, 38600c0, b503d08 | clean |
| F05 | Dashboard page | 7d94399, c8d721d | 1 fix round: warnings as alerts, weekly buckets |
| F07 | Documents table | 5294590, b6e90bd, a39663d | 1 fix round: page past the end, status validation |
| F09 | Document actions | 895a626, 5408524, ae078a0 | 1 fix round: confirm every status change, refresh the tree |
| F10 | Search and live command palette | dc69b84, d2b32be, 6dcc6fe, 03fc256 | 1 fix round: Enter opened a stale result |
| F14 | Upload | 5124384, 3124379, e4743ad | approved; 1 polish round |
| F12 | Generate: picker and dynamic form | 3945385, e812b52, 35d0ee8 | 1 fix round: row error paths, stale choices after a brand switch |
| F15 | Entities | 152d9cf, 8aa4c8b, e78ca73 | approved; 1 polish round: grouped counts, `entityId` tests |
| F17 | Settings: brands | dba5d30, dc7d575, 6d673b5 | 1 fix round: first save of the root brand failed, an upload was undone by the next save, New brand could overwrite |
| F20 | Logo kit and favicon | 828f970, 57bb777 | clean |
| F13 | Generate: live preview, generate, regenerate | 9e02eac, ea2fe81, 3658a2c, 5de1663 | 2 fix rounds: preview problems flickered while typing, stale answers marked fields |
| F18 | Settings: numbering, workspace, users | 99614f2, 42b54f5, 7bc3033 | 1 fix round: lowering your own clearance, top-level folder renames |
| F23 | Docker image and compose file | fc3de2f, 2d39759 | clean; a hardening commit followed |
| F21 | Remove the old UI | 5caf983, 2a76af0, a476a1e, 42d9445 | approved; 1 polish round: stricter `/api` and file-path matching |
| F22 | Responsive and accessibility pass, chunk split, test flakes | c61594f, 4541803, 36fce1a, 03087db, 0e95fb2 | 1 fix round: skip link changed the URL, commits that did not typecheck alone |
| — | `sharp` 0.35.5 security upgrade | 58abfbd, 0468021 | verified by the coordinator (see rulings) |
| F24 | Release preparation: changelog, versions, docs | 63b11fc, c8d4a5c | final whole-branch review |
| — | Final fix wave: optimistic concurrency for settings saves, clearance-filtered entity counts, eight minor fixes | branch `fix/final-wave` | fixes for the final review's findings |
| F25 | Visual polish: floating navigation, layout rhythm, view transitions, tab state in the URL, alignment fixes, Playwright e2e | 6ce890d, 412bb20, cbae482, 82e5ee9, 8776194, 6571eab (branch `feat/f25-polish`, rebased on e454f87) | 2 fix rounds: the sidebar rail still covered 2 px of the page when collapsed, hidden preview and viewer frames reloaded in the background; the content fade replayed after each view transition, entities with `?kind=` stayed loading when `/api/meta` failed |

### Rulings made during the build

These decisions were taken without asking the owner, except where noted. Each one notes what it costs if it was wrong.

1. **The npm workspace and `test:web` were added in F03, not F01**, because `web/` did not exist yet and `npm ci` had to keep working. No cost.
2. **The old UI kept `/` and its paths until F21**, and the web app was served only for unmatched paths meanwhile, so `main` never had a half-working UI. Until F21 the web app was reachable only on new paths such as `/vault` and `/dashboard`.
3. **Work went straight to `main`** (owner's decision), with no pull request at the end. The tag `v1.0.0` follows the final review. There is no PR record; `CHANGELOG.md` and this log carry the history.
4. **The product's repository URL may appear in the app**, because it is the product's public home, not organisation data. It is read from `package.json` `homepage` and `repository`, so a fork must edit `package.json`.
5. **Dashboard series counters are not filtered by clearance.** Sequence values are workspace configuration, and generate previews already show the next numbers. A low-clearance user can infer that numbers were issued.
6. **For parallel work, a preparation commit added every shared component and dependency up front.** Feature agents never edited `package.json`, the lockfile, `CHANGELOG.md`, `docs/DECISIONS.md` or the README; the coordinator wrote those entries at merge. No cost seen.
7. **Agent worktrees (`.claude/worktrees/`) are git-ignored.** No cost.
8. **F12 reused F06's jsdom stub for resizable panels byte for byte**, to avoid two diverging stubs in the test setup. If wrong, one merge conflict.
9. **Testing Library's async timeout was raised to 5 s and Vitest's test timeout to 15 s**, because the first lazy page in a file timed out under full parallel runs. Failures are reported more slowly.
10. **Pushes are gated on the test exit code** after one push went out before the tests had finished (see incidents). No cost.
11. **The `sharp` upgrade was verified by the coordinator instead of a reviewer agent.** It changed only the lockfile, and the outputs were byte-identical. The coordinator ran `npm ci`, the runtime audit (0), both test suites, samples and the visual checks (41 of 41), and loaded `sharp` in the Docker image. If this was wrong, the final review re-checks it.

### Incidents

Phase 1's two rules (no browser tools; nothing written outside the repo) held except where listed below. The logo renderer's command-line headless Chrome (F19, F20) was the one permitted exception, and the owner later allowed Playwright for F25.

- **A worktree was created outside the repo.** A typo by the coordinator created a git worktree in the folder next to the repo. It was clean and was removed with `git worktree remove` within a minute. Nothing else was touched.
- **A temporary file was written outside the repo.** The F21 agent wrote a temporary file under `/tmp` (outside its allowed temporary folders) and deleted it afterwards; it was checked to be gone.
- **The logo renderer may have touched the owner's Chrome profile.** The logo task's renderer runs headless Chrome from the command line. Files in the owner's normal Chrome profile and updater folders changed during that window, but those change during normal use too. Whether the renderer caused it is unconfirmed.
- **Pushes failed and were retried.** GitHub answered one push with a server error (500), and a DNS outage blocked another. Both succeeded on retry.
- **One push went out before the tests had finished.** Nothing was broken: the suite passed on the next run apart from one known flaky test. Pushes have been gated on the test exit code since (ruling 10).
- **Some web tests were flaky under heavy load:** the app-shell flyout, a documents-table cell and the entities tabs. F22 fixed them by rendering pages directly instead of the whole app.
- **Two coordinator sessions worked on the same build at once.** After a restart, a forked coordinator session ran alongside the original, which was still running inside another editor. Both merged or prepared the same work, and each started its own F24 worktree. The fork stopped and removed its duplicate (it had no commits). Later the owner asked the fork to take over, and with the owner's approval it stopped the original session's process. The original had committed F24 seconds earlier; the fork re-ran every check on those commits before merging.
- **An agent stopped mid-task.** The sharp upgrade agent died after installing but before committing. A new agent resumed it in the same worktree.
- **A stale server served a deleted bundle.** A running server kept an `index.html` whose bundle had been rebuilt away, so the app loaded blank. It was restarted, and the fix wave made the server re-read `index.html` when it changes.
- **The F03 agent tried one redirect outside the repo.** It was refused and nothing was written.
- **Chrome rewrote one file under `~/Library` during F25's first Playwright runs.** About 25 seconds into each browser session, Chrome rewrote its RLZ store, `~/Library/Application Support/Google/RLZ/RlzStore.plist`: an existing 294-byte file, same content, nothing deleted. A 90-second idle check confirmed the runs caused it. Chrome writes it regardless of `--user-data-dir`, and `HOME` did not redirect it; setting `CFFIXED_USER_HOME` to the run's temporary folder did, and the file's modification time stayed unchanged across every later run. This is the likely cause of the unconfirmed `~/Library` change during the logo task (F19, F20) too, since that renderer also ran Chrome.
- **F25 deleted two temporary folders, both its own:** an empty `dossier-e2e-*` folder left by an interrupted run and a `dossier-explore.*` workspace copy, both in `$TMPDIR`. Other `dossier-*` folders there were left alone.
- **The fix-wave agent wrote one log file to the system temp folder** (`$TMPDIR/npmci.log`, an `npm ci` log) instead of its own `mktemp -d` folder. It deleted the file straight after reading it; the controller confirmed it was gone.

### Open items

These minor findings were parked during reviews. None blocks use.

- **Web client:** the API client types a non-JSON success reply as JSON; a few upstream command-palette quirks.
- **Dashboard:** the recent-documents list runs about 20 small queries; the number-conflict message can hint that a hidden document exists; the chart chunk is not prefetched.
- **Settings saves (fix wave):** `If-Match` is optional, so scripts and other HTTP clients still save last-write-wins (no MCP tool writes these files); a hand edit that keeps a file's bytes identical is (correctly) not a conflict. A conflict offers only Reload; there is no merge of the unsaved edits with the newer file.
- **Web build serving (fix wave):** a rebuild that writes an `index.html` of the same size within the same millisecond as the old one is not noticed until the next change; a server started before `web/dist` existed still needs a restart to serve the bundle.
- **Vault:** expanding a folder downloads its whole subtree again (a backend `depth=1` option would fix it); a brief double mount on mobile; a fixed minimum height; no tests for tree or right-pane server errors.
- **Documents and document page:** the party-kind filter list; a refetch while a date range is half filled; the count and list queries run outside one transaction; a mouse-wheel scroll check in a picker; aligning the add-link search with the main search; a sensitivity `FORBIDDEN` error is not shown on its field; the old status flashes while a dialog closes.
- **Search:** the palette unmounts before its close animation ends; one arrow-key test does not tell the two choices apart.
- **Templates page:** the version, numbering and sensitivity columns cannot be sorted; rows contain duplicate links.
- **Generate:** a three-way switch for optional booleans; the entity combobox has a result cap and no free text; a field mark is lost when its list row moves after a removal.
- **Upload:** a 413 reply is shown as a network error; unknown clearance levels are not handled specially.
- **Entities:** no index on `issuing_entity_id`; entity search is not designed for more than 500 entities; punctuation is not folded in matching; the breadcrumb shows the id, not the name.
- **Settings:** saving a brand trims, lowercases and rewrites blank lines in some fields; renaming a series can leave extra keys.
- **F25 e2e:** `screens.spec.ts` waits a fixed 400 ms for entrance fades before each screenshot (parked; screenshots are for looking at, not assertions).
- **Logo kit:** `export_kit.sh` gives an unclear message when the logo skill is missing; no check that the favicon master and its public copy match.
- **Docker:** the Node base image is not pinned to a minor version; the healthcheck accepts any reply below 500.
- **Development dependencies:** 4 moderate audit findings in development-only tools (`minimatch` through `@ts-morph` and others); none ships in the runtime image.

## Where to look next

- `README.md`: setup, running, testing, customising, MCP, import and Docker.
- `CHANGELOG.md`: what changed in each version.
- `docs/WEB.md`: the web app's architecture, development, build and Docker.
- `docs/PLAN.md`: architecture and data model (phase 1), with a pointer to phase 2.
- `docs/DECISIONS.md`: every small decision, with reasons.
- `docs/WORKSPACE.md`, `docs/TEMPLATES.md`, `docs/MCP.md`: reference guides.
