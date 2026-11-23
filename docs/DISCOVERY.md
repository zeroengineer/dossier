# DISCOVERY: existing document system (findings)

> Organisation identifiers, bank details, phone numbers and salary figures are redacted here (`<GSTIN>`, `<bank-account>`, ...). Organisation, brand, client, event and person names are replaced by neutral labels ("the company", "group entity", "product brand A", "client event 1", "employee 1", "director 1"); legacy script and asset file names that contained such names are described instead of quoted. The unredacted copy lives in the private workspace (`dossier-workspace/docs/DISCOVERY.full.md`), which is never committed. Paths are relative to the folder the legacy scripts live in (`Company Documents/`).

## A1. Generation style (what Dossier must match)

| Aspect | Finding | Reference |
|---|---|---|
| Runtime | Node 22 (v22.23.4 installed), npm 10 | — |
| Module system | ESM (`"type": "module"`), `createRequire` for pdfkit | `PDF Generator/package.json`, every script line 1-8 |
| Libraries | `pdfkit ^0.18.0`, `sharp ^0.34.5` only | `PDF Generator/package.json` |
| PDF production | pdfkit draws everything by absolute coordinates; images pre-processed by sharp (`resize`, `trim`, `flatten({background:'#ffffff'})`) | `scripts/legacy invoice script (client event 1):35-49` |
| Page | A4 in points `PW=595.28`, `PH=841.89`, `bufferPages:true`, `autoFirstPage:false`, `page.dictionary.data.Rotate=0` | same, lines 13-14, 52-57, 68 |
| Fonts | Manrope static TTFs registered as `Regular, Medium, SemiBold, Bold, ExtraBold` (some scripts alias `Body*`) | `PDF Generator/Manrope/static/*.ttf` |
| Templates + data | No templating: each script is a copy with data edited inline; markdown in `MD file/` is a human-readable source, not read by scripts | `PDF Generator/MD file/*.md` |
| Rich text | `**bold**` tokenizer, manual justified line layout (`tokenize/groupTokens/renderParagraph`), `richBullets`, `needsBreak`, `drawHeader` on `pageAdded`, footer post-pass via `bufferedPageRange` | `scripts/legacy offer-letter script (employee 1):154-332, 676-685` |
| Currency/date | `'₹ ' + n.toLocaleString('en-IN', {min/max 2})`; invoice dates `DD/MM/YYYY`; letters `29 August 2026` | `legacy invoice script (client event 1):27-32, 71-78` |
| Output | `createWriteStream(join(__dirname, 'Invoice - <no>.pdf'))`, promise on `finish` | lines 326-341 |
| Second toolchain | Brochures: Claude Design `.dc.html` printed with `puppeteer-core` + system Chrome (`preferCSSPageSize`, `printBackground`, margin 0, A4 landscape 297x210mm); product brand A brochure via `window.print()` | `<product-C folder>/brochure/print-brochure.js`, `<product-A brochure folder>/brochure.css` |
| HTML renditions | `PDF Generator/HTML/*.html` are older hand-written Lato/`#6c757d` invoices and statements, not generated; images referenced relatively and missing | `PDF Generator/HTML/<client-event-6 invoice>.html` |
| Python | `legacy group-entity internship-certificate script (employee 8)`, `stamp-experience-certificate.py` use PyMuPDF to stamp group-entity certificates | `scripts/*.py` |

## A2. Layout constants (exact)

Two layout families exist; Dossier ships both as shared "layout profiles".

**Invoice family** (invoice, debit note, receipt): `legacy invoice script (client event 1)`
- Margins 40/40/40/40, `CW = 515.28`.
- Logo `company-logo.png` sharp-resized height 45, drawn `{height: 26}` at (ML, MT).
- Title `ExtraBold 22 #1a1a1a` right-aligned at `MT-4`; meta rows `SemiBold 8.5 #555555` labels / `Bold`/`Medium` values at `MT+26`, `+13`.
- Divider `#e8e8e8` 0.5pt at `dateY+20`; addresses at `+15`, column width `CW/2-10`, right column at `ML+colW+20`.
- Headings `Bold 9.5 #1a1a1a`; body `Regular 8.5 #555555`, `lineGap 1.5`; FROM block prints GSTIN/phone/email/website as `SemiBold 8 #555555` label + `Medium #333333` value.
- Table: header rect `#1a1a1a` height 22, `Bold 8.5 #ffffff`, columns `[35, 275, 80, 125.28]`, left pad 8; row fill `#fbfbfb`, row text `Medium 8.5`, bottom rule `#e8e8e8`.
- Summary: bank block `Bold 9` heading + `SemiBold 8` labels; calc column width 200 at `PW-MR-200`, row height 18; total pill `roundedRect(calcX-6, y-4, 206, 24, 3)` fill `#1a1a1a`, `Bold 9.5 #fff`.
- Signatory: `Bold 8 #555555 'FOR <COMPANY LEGAL NAME>'` right-aligned width 200; `signature.png` flattened, height 45, right-aligned; name `Bold 9`, title `Medium 8 #666666` at `+12`.
- Bottom: declaration `Bold 8.5` + `Regular 7.5 #666666` at `stripY-45`; rule `#f0f0f0`; `Bold 8 #888888 'THANK YOU FOR YOUR BUSINESS'` centred at `PH-MB-10`.

**Letter family** (offer letters, certificates, MoUs, proposals, settlements, statements): `legacy offer-letter script (employee 1)` (most other scripts use `ML=MR=42, MB=39, MT=100, CP=14`)
- Margins `ML=MR=37.5` (or 42), `MB=39`, `MT=100`, `CP=10` (or 14), `LOGO_H=32`.
- Header: logo sharp height 80, drawn height 32, vertically centred against a right-aligned text block: `Bold 8.5 #1a1a1a` company name, then `Regular 8 #555` CIN / address lines / email line, gaps 1, 0.5, 0.5, 0.5; rule `#e8e8e8` 0.3pt at `textY+textBlockH+6`.
- Footer: rule `#d0d0d0` 0.5 at `PH-MB+1`; `Regular 7.5` left `#666` contact, centre `#999 'Confidential'`, right `#666 'Page n of N'` at `PH-MB+8`.
- Body: section header `BodyBold 17` uppercase, `lineGap 2`, moveDown 0.5/0.65; clause header `BodyBold 12`, `lineGap 1.5`, moveDown 0.35/0.45; paragraph `10.5`, `lineGap 4.5`, `#333333`, justified, moveDown 0.65; bullets indent 14, bullet at `ML+5`.
- Tables: row height 22, header fill `#1a1a1a` `BodyBold 9.5 #fff`, left pad 10, alternating `#f8f8f8/#ffffff`, totals row `#f1f1f1`.
- Signature block: `authorised sign.png` flattened, height 55; seal `company seal.png` trimmed, resized width 600, drawn width 76 at `PW-MR-76-8`, rotated -6°, opacity 0.85; name `BodyBold 10`, title `BodyMedium 9 #666666` +14, "Authorized Signatory" `Regular 9` +26.
- Palette families seen elsewhere: slate (`#0f172a #334155 #e2e8f0 #cbd5e1 #94a3b8 #f8fafc`) in MoU and settlement scripts; neutral gray (`#111827 #e5e7eb #4b5563`) in proposals; product brand B (`#141414 #0A6B35 #F2FAF5`); society client `#005BAA`; group-entity gold `#c5a880`.

(The script-by-script catalogue from the third discovery agent is appended in A8 once received.)

## A3. Document types and fields

| Type | Source | Key fields |
|---|---|---|
| Invoice | `generate-*-invoice.js` | number, date, billTo{name,address}, items[{sno,description,hsn,amount}], tax mode (none / CGST 9+SGST 9 / IGST 18), subtotal, total, bank, signatory |
| Debit note | `legacy debit-note script (client event 1)` | as invoice; "DEBIT TO"; reference invoice |
| Receipt | `legacy receipt script (client event 1)` | "RECEIVED FROM"; references invoices + debit note; amount received |
| Offer letter / internship offer | `generate-*-offer-letter.js`, `MD file/offer letter *.md` | date, candidate{name,address,mobile}, role, internship period, joining date, CTC figures+words, 15 clauses, Annexure salary table, acceptance block, signatory |
| Internship / experience certificate | `generate-*-certificate.js`, `.py` | certificate no `CO/HR/YYYY/EXP-NNN`, name, role, period, signatory, seal |
| Relieving letter | `HTML/Relieving Letter.html` | name, designation, joining/relieving dates |
| Final settlement (employee) | `generate-*-settlement.js` (two employee scripts) | name, designation, department, period, working days, salary, per-day, deductions, net |
| Client settlement / ticketing statement | legacy client-settlement script (client event 1); statement scripts for client events 4, 7, 8, 9 | `FSS/<CLIENT>/YYYY/NNN`, issued-to, event, fee, GST, advance, balance, expenses, MoU reference |
| Remittance statement | `legacy remittance-statement script (client event 2)` | statement no, transaction date, particulars, amount, client bank, gateway |
| Registration summary | `legacy registration-summary script (client event 5)` | event, counts, categories |
| Expense statement | `legacy expense-statement script (client event 3)` | client, event, expense lines, amount in words, bank |
| MoU (organisation / event / annual / draft) | `generate-*-mou.js`, `MD file/*_MoU*.md` | date, first party (the company, CIN, office), second party {org, type, reg no, address, representative}, event details, fee clauses (2%+GST, gateway 2%+GST, T+7), term, signatories |
| Proposal / quotation | `generate-*-proposal.js` | quotation no `COX-<CODE>-YYYY-NN`, prepared for/by, commercial model, pricing tables, scope, T&C, contacts |
| Ticket pricing report | `generate-*-report*.js` | report no `COX-REP-YYYY-NNN`, pricing models, tables |
| Board resolution | `generate-board-resolution.js` | date, resolution text, directors |
| Feature listing / PRD / spec / playbook / portfolio | `legacy feature-listing script (product A)`, `legacy PRD/spec scripts (client S6)`, `legacy playbook script (product E)`, `generate-portfolio.js` | `COX-DOC-YYYY-<CODE>` for product docs |
| Agreement (product D) | `legacy agreement scripts (product D)` | parties, scope, fees |

## A4. Assets (go into the private workspace `dossier-workspace/brands/*/assets/`, see B15; the repo ships only fonts and neutral placeholders)

| Asset | Canonical file | px | Use |
|---|---|---|---|
| Company wordmark (black, alpha) | `PDF Generator/assets/company-logo.png` | 1027x234 | every header |
| Company title logo black / white / shadow | `<company documents folder>/Assets/…` | 2791x636 | brand kit only |
| Company seal | `PDF Generator/assets/company seal.png` | 1586x1471 | letters, certificates, MoUs. **Sensitive**: fake seal placeholder in repo |
| Director 2 signature (invoices) | `PDF Generator/assets/signature.png` | 1024x406 | **Sensitive**: placeholder |
| Authorised sign (letters) | `PDF Generator/assets/authorised sign.png` | 5914x4873 | **Sensitive**: placeholder |
| alt sign | `PDF Generator/assets/alt sign.png` | 547x217 | expense/remittance. **Sensitive** |
| Group-entity title logo / icon / seal | `PDF Generator/assets/group-entity title logo.png`, `group-entity icon logo.png`, `final/07 …/group-entity-seal.png` | 2820x750, 619x750, 1254x1254 | group entity. Seal **sensitive** |
| Society-client logo pad | `PDF Generator/assets/logo pad.png` | 2187x157 | society-client-branded docs |
| Product brand B logo | `PDF Generator/scripts/brand-B-logo.png` | 2400x592 | product brand B quotations |
| Product brand A icon / title | `<product-A folder>/assets/*.png` | 505x437, 3680x1052 | product brand |
| Fonts | `PDF Generator/Manrope/static/*.ttf` (7 weights, OFL), `scripts/JetBrainsMono-SemiBold.ttf` (unused) | — | copy Manrope + OFL.txt |
| Missing | `Figtree/static/*` referenced by the portfolio and society-header scripts, not on disk | — | note in DECISIONS; substitute Manrope |

Real logos, signatures and seals live only in the private workspace brand folders; the repo ships SVG-rendered neutral placeholders with identical pixel dimensions so layout tests pass on the example workspace.

## A5. Numbering formats (evidence in `_index.csv`, filenames, scripts)

| Series | Pattern | Seen | Notes |
|---|---|---|---|
| Invoice | `CO-YYYY-NNNN` | 0130–0139 | one 4-digit counter **shared** with DN and REC |
| Debit note | `CO-DN-YYYY-NNNN` | 0134 | |
| Receipt | `CO-REC-YYYY-NNNN` | 0135 | |
| Quotation / proposal | `COX-<CODE>-YYYY-NN` | AAA-2026-01, BBB-2026-18, CCC-2026-03… | code per client/product |
| Pricing report | `COX-REP-YYYY-NNN` | 126–129 | |
| Product doc | `COX-DOC-YYYY-<CODE>` | one product code | |
| HR certificate | `CO/HR/YYYY/EXP-NNN` | 004, 010, 011, 012 | |
| Client settlement | `FSS/<CLIENT>/YYYY/NNN` | <CLIENT>/2026/001 | |
| Product brand B quotation | `CO-QT-YYYY-NNN` | 001, 021–023 | |
| Remittance | `<EVENT>-Remittance-Statement-NN` | 01–09 | filename only |

Reused numbers already exist (0131, 0132, 0133 each on two documents; 0134 title/body mismatch). Year = calendar year. Dates are often "today at generation time".

## A6. Vault spec and current `final/` tree

Spec: `final/VAULT_HIERARCHY.md` (top level = who; leaf = what kind; engagement level only when >1). Metadata fields, file naming `<date>_<party>_<type>_<number>_v<version>.<ext>`, 8 rules. The existing `final/` drifts: `04 Products`, `05 Templates`, `06 Vendors - Invoices Received` (flat), `07 <group entity>…`, `09 Generator Source`, `10 Restricted - Security`; no Finance; client leaf `MoU` not `Agreements`; people folders flat. `final/_index.csv` (775 rows: original_path, vault_path, vault_folder, md5, size_bytes, note) already demonstrates md5 dedupe ("identical copy … not copied again") and name-clash suffixing (`[from <folder>]`).

## A7. Parties and constants (seed master list; real values go in config, not seeds)

- Company: <legal name> (a private limited company). CIN <CIN>, GSTIN <GSTIN>, PAN <PAN>, Udyam <UDYAM>, DPIIT <DPIIT>. Business address: <street address line 1>, <street address line 2>, <city>, <state> <PIN>. Bank: <bank> <branch>, A/c <bank-account>, IFSC <IFSC>. Emails `business@<product-A domain>`, `hr@<company domain>`, etc. Signatories: Director 1 (Managing Director; "<director 1>, CEO & Managing Director" on letters), Director 2 (Chief Operating Officer, signs invoices), Director 3 (Director).
- Group entity: The group entity (an LLP) (LLPIN <LLPIN>, <group-entity website>) issued some HR documents.
- Business lines: `Events - <product A>` (≈26 clients: client events 1–24, mostly college fests, conferences and summits), `Software and Services` (clients S1–S6, product brand B prospects).
- Products: product brands A–G (seven products, including the events-ticketing product A and the design-studio brand B). Vendors: vendor 1 (hardware), vendor 2 (domains).
- Sensitive, never copied: `Security/`, `final/10 Restricted*`, `<company documents folder>/Team Documents/`, `Legal Documents/` KYC, `<product E>/TP AUDIT*`, all real signatures/seals, HR letters with addresses/salaries.

## A8. Script catalogue (85 `.js`, 2 `.py`, `watermark.js`; all in `PDF Generator/scripts/` unless noted)

**Shared letterhead** (`generate-proposal.js:48-72`): `MT=100`, `LOGO_H=32`, logo at `x=ML`, `logoY = textY + (textBlockH-32)/2`, `textY = (MT - textBlockH)/2`, `textBlockH = lh(Bold 8.5) + 1 + 4*lh(Regular 8) + 1.5`. Right block: `Bold 8.5 #1a1a1a` legal name; `Regular 8 #555` CIN, address line 1, address line 2, `Email: <x> | <company website>` (gaps 1, 0.5, 0.5, 0.5). Rule `#e8e8e8` 0.3 at `textY+textBlockH+6` (≈85). Content starts `MT+CP`. Email varies: `business@<product-A domain>` (proposals, reports, settlements), `hr@<company domain>` (employee 1 documents), `hr@<product-A domain>` (employees 2, 3 and 4, intern), `business@<company domain>` (board resolution, remittance, registration summary, client S5, product brand B).

**Shared footer** (`generate-proposal.js:77-99`): rule `#d0d0d0` 0.5 at `PH-MB+1`; text at `PH-MB+8`, `lineBreak:false`: left `Regular 7.5 #666` email | website (width CW/2), centre `Regular 7.5 #999 'Confidential'`, right `Page N of T`. Drawn in post-pass: remove `pageAdded` listener, `bufferedPageRange`, `switchToPage`, `margins.bottom=0`, draw, restore, `flushPages`. Variants: `CONFIDENTIAL` `SemiBold 7.5 #666` charSpacing 1.2 (remittance, registration summary); no centre text (certificates, product brand B, board resolution); no page number (board resolution).

**Shared helpers**: `needsBreak(min) = doc.y > PH-MB-CP-min` (MoUs: no CP). `tokenize/groupTokens/renderParagraph` justify all lines but last by spreading `(width-Σwords)/(n-1)`; MoU/agreement variants draw `₹`-words ExtraBold at +0.5..+1 shifted up 0.3-0.5; Organisation MoU skips justify when gap > 2.2×space or line has `__`. `richBullets`: `•` at `ML+5`, indent 14. Currency: invoices `'₹ ' + en-IN` (space), others `'₹' + en-IN`. Dates: invoices `DD/MM/YYYY`; letters/certificates/settlements `29 August 2026`; reports `October 29, 2026`; group-entity Python `31st October 2024`. TOC: `sectionPages[key]=currentPageNum`, page numbers written in post-pass `Regular 11/11.5 #aaa`.

**Margin families**

| Family | ML/MR | MT | MB | CW | CP |
|---|---|---|---|---|---|
| Invoice / DN / receipt | 40 | 40 | 40 | 515.28 | — |
| Letterhead (letters, certificates, proposals gen1-2, settlements, statements, agreements, feature listing, PRD) | 37.5 | 100 | 39 | 520.28 | 10 (settlements 12) |
| Proposals gen 3 (client events 12, 13, 14) | 40 | 100 | 42 | 515.28 | 12 |
| Product brand B | 42 | 100 | 39 | 511.28 | 14 |
| MoU v1 (client event 3 MoUs, draft-mou) | 45 | 55 | 55 | 505.28 | — |
| MoU v2 (organisation, draft-event, client events 24, 22, 23, 19, 2) | 45 | 50 | 50 | 505.28 | — |
| Society-client header | 24 | 24 | 24 | 547.28 | — |
| Group-entity settlement (employee 6) | 40 | 0 | 0 | 515.28 | — |

**1. Invoice / debit note / receipt** (`generate-invoice.js` base; client event 1 invoice 0132, its balance invoice 0133 and an IGST variant of 0133, client event 4 0136, client event 10 0137, client event 7 0138, client event 8 0139, client event 1 debit note DN-0134 and receipt REC-0135). Single page. Logo sharp h45 → drawn h26 at (ML,40). Title `ExtraBold 22` right at y36 ("INVOICE" / "DEBIT NOTE" / "PAYMENT RECEIPT"). Meta y66 label `SemiBold 8.5 #555555` in width `CW-80` (DN/REC `CW-100`), value `Bold`; date y79 value `Medium`. Divider y99. Addresses +15, `colW=CW/2-10`; "BILL TO"/"DEBIT TO"/"RECEIVED FROM" `Bold 9.5`; name `Bold 9.5 #333333` +15; address `Regular 8.5 #555555` width `colW-10`; right column `ML+colW+20` "FROM"/"RECEIVED BY", contact lines label `SemiBold 8 #555555` + value `Medium #333333` `continued`, `y+2`: GSTIN, Phone <phone>, Email business@<product-A domain>, Website. Divider `max(doc.y+20, addressY+95)`. Table header rect h22 `#1a1a1a` `Bold 8.5 #fff` at y+7; columns `[35,275,80,125.28]` (receipt `['S.NO','DESCRIPTION','REFERENCE','AMOUNT']` `[32,243,120,120.28]` size 8, rows h34); row fill `#fbfbfb`, text y+12 `Medium 8.5` (client events 7/4/10/8: `Bold`), description width `275-15`; row height 44 (base, client event 7), 70 (client event 4), 105 (client event 1), `max(44, heightOfString+24)` (client event 8); DN rows h24 alternating `#fbfbfb/#fff` rule `#cbd5e1`. Summary at row bottom +15: bank block (`Bold 9` heading, label `SemiBold 8 #555555`, value `Medium #333333`: Account Name / Bank Name <BANK> / Account No <bank-account> / IFSC <IFSC> / Branch <BRANCH>); receipt instead `roundedRect(ML,y,CW-220,80,3)` stroke `#cbd5e1` "ACKNOWLEDGMENT & FINAL SETTLEMENT" `Bold 8.5` + `Regular 8 #444444` lineGap 2.2. Calc column x `PW-MR-200`, row h18, rows Subtotal / CGST (9%) / SGST (9%) or IGST @ 18% or subtotal only; total pill `roundedRect(calcX-6,y-4,206,24,3)` `#1a1a1a` `Bold 9.5 #fff` ("Total Invoice"/"Total Debit Note"/"Total Received"). Signatory divider `max(doc.y+35, bankY+65)`; `Bold 8 #555555` FOR … right width 200; `signature.png` h45 at `PW-MR-sigW`, y+12; "DIRECTOR 2" `Bold 9` y+60; "CHIEF OPERATING OFFICER" `Medium 8 #666666` +12. Bottom (`margins.bottom=0`): stripY `PH-MB-10`; Declaration `Bold 8.5` at stripY-45 + `Regular 7.5 #666666` lineGap 1.5; rule `#f0f0f0` at stripY-8; `Bold 8 #888888` centred THANK YOU. HSN always 998596. Outputs `Invoice - <no>.pdf` in `scripts/`, `../Invoices/`, `../PDF/`.

**2. Offer letter** (`legacy offer-letter script (employee 1)` canonical; employee 2; employee 3 older). Letterhead family. `sectionHeader` `BodyBold 17` upper, lineGap 2, md 0.5/0.65, break <60; `clauseHeader` `BodyBold 12`, lineGap 1.5, md 0.35/0.45, break <90 (employee 2: 45); body 10.5 / lineGap 4.5 / `#333333` justified md 0.65; bullets indent 14, item md 0.35, list md 0.45. Page 1: `doc.y=MT+CP+20` date `BodyBold 10` right; `MT+CP+45` "To," `BodyBold 10`, name `BodyBold 10.5`, address `BodyRegular 10 #333` lineGap 3; md 2.2; subject `BodyBold 12` centred lineGap 2.5; md 2.0; "Dear X," 10.5; paragraphs md 1.2. Then TERMS OF EMPLOYMENT (15 clauses), ANNEXURE 1 tables (row h22, header `#1a1a1a` `BodyBold 9.5 #fff` text y+5, rows `#f8f8f8/#fff`, label `BodyRegular 9.5 #333333`, values `BodyMedium #1a1a1a` right; earnings cols 200/150/170.28 with Gross row `#f1f1f1` Bold; deductions & summary 250/270.28), ACCEPTANCE OF OFFER. Signature: `BodyBold 9.5` For …; `authorised sign.png` h55 at y+24; seal w76 at `PW-MR-84`, stampY-8, opacity 0.85, rotate -6; name block stampY+55+22: "Director 1" `BodyBold 10`, "CEO & Managing Director" `BodyMedium 9 #666666` +14, "Authorized Signatory" `Regular 9 #666666` +26. Employee 2: no seal, stamp +16, name +10, 60-day notice. Employee 3: `signature.png`, Director 2/COO (Bold 11, Medium 10 +20, Regular 10 +38), header 8/7.5, footer 7, body lineGap 2.5.

**3. Internship offer** (`generate-intern-offer-letter.js`): as 2 with lineGap 4.0, no annexure, no seal (stamp +16, name +10), subject "OFFER OF INTERNSHIP -- …", TERMS OF INTERNSHIP 15 clauses, stipend, 7-day notice.

**4. Certificates** (employee 1 EXP-011 "INTERNSHIP COMPLETION CERTIFICATE", employee 2 EXP-010, employee 4 EXP-004 "INTERNSHIP CERTIFICATE", employee 5 EXP-012 "EXPERIENCE CERTIFICATE"). Letterhead, no bufferPages, footer email left + "Page 1 of 1" right, no Confidential. `doc.y=MT+CP+25`: `Ref: CO/HR/2026/EXP-0NN` left, `Date:` right, `Bold 9.5`; md 3.0; title `ExtraBold 14` centred; md 2.5; "To Whom It May Concern," `Bold 10`; paragraphs 10 / lineGap 5 justified md 1.2 (last 2.2). Signature `Bold 10` For …; `authorised sign.png` h50 at y+24; seal as above; name at stampY+72. Employee 2: no seal (+16/+10). Employee 4: `signature.png`, Director 2 / Chief Operating Officer (COO).

**5. Group-entity certificates (Python, PyMuPDF)**: `legacy group-entity internship-certificate script (employee 8)` redacts `Rect(40,165,560,670)` of an existing PDF and inserts HTML (Manrope via `fitz.Archive`): title 800/17pt `#0d1220`; date SemiBold 10 `#5b6272` right; salutation bold 11.2 `#8d94a1` spacing 0.8; body 11.2 lh 1.8 `#31384a` justified mb 14; `.for` bold 11; `.name` bold 12; `.role` 10.2 `#6b7280`; margins 52.5/542.5; `alt sign.png` h54; `group-entity-seal.png` rotated -90 w92; signer Director 2, Head of HR. `stamp-experience-certificate.py`: finds the signer's name, signature h52 above, seal w92 right, margins 72/524.

**6. Employee final settlement**: 6a group entity (`legacy group-entity settlement script (employee 6)`): ML/MR 40, margins 0, logo `group-entity title logo.png` w180 centred y22; `LLPIN: <LLPIN>` `Bold 8.5 #0d1220` y75; contact `SemiBold 8 #1f2637` y89; rule y108 `#9aa0aa` 0.75; watermark icon w280 y270 opacity 0.045; footer rule `PH-38` `#d1d5db`, `SemiBold 7.5 #9ca3af` centred `PH-28`. Title `ExtraBold 14.5` y126; meta grid y158 rh18 labels `Bold 9.5`, values `Medium 9.5 #2d3748` at x ML, ML+115, ML+305, +85 (Employee Name, Department, Designation, Settlement Period); tables header h24 `#f8f9fa` stroke `#e2e8f0` `Bold 10`, rows h23 odd `#fafafa`, `•  ` label `Regular 9.5 #2d3748`, value `SemiBold/Bold 9.5 #111827` right in 150 col (Salary Details, Earnings, Deductions); net box h46 stroke `#4b5563` 0.8 fill black 0.015; signatures y744 cols 140/95/140, `authorised sign.png` trimmed h46. 6b company (`legacy company settlement script (employee 7)`): same tables on letterhead (title header+16, meta +54 gap 24, header h28 rows h26, net box 50, sig line y755 cols 150/100/150), attendance deduction (`MONTHLY <salary>`, `WORKING_DAYS 25`).

**7. Ticketing & settlement statement** (client event 9 newest, client events 8, 4, 7): letterhead `CP=12`; `onPageAdded` sets `doc.y=MT+CP+125`; title block repeated per page in post-pass: `ExtraBold 16.5` "TICKETING & SETTLEMENT STATEMENT" centred y101; rule y134 `#e2e8f0`; meta y144 labels `Regular 10 #555555` w60 (Event/Issued To/Issued By) values `Medium 10 #1a1a1a` +65; right col `ML+colW+20` Date / Page No. step 19. Section bar `rect h24 #606f7b` `Bold 10 #fff` upper at (+8,+7) then +36. Ticket table cols 210/100/100/rest (client event 8: 175/95/80/80/rest), header `Bold 8 #555555` h26 rule `#1a1a1a` 0.8, rows h25 `#f9f9f9/#fff` `Regular 9 #333` rule `#e2e8f0`, total `#f1f1f1` Bold. Charges card `roundedRect r4 #f7f7f7` 3pt bar `#606f7b` pad 14, "Platform Fee (x%)" `Bold 11`, lines `Regular 9.5 #555`, total `Bold 10.5`; final box h70 `fillAndStroke('#f7f7f7','#606f7b')` label `Bold 10.5` amount `ExtraBold 20`; acknowledgement `Regular 9.5` justified lineGap 3; fields Name/Designation/Signature & Seal/Date spacing 42 rules `#bbbbbb`. Client events 4/7 older: cols 235/75/100/rest rh26 font 10, two charges boxes h95 `#f9f9f9` bar `#606f7b`, final box h145 amounts 11/12.5/ExtraBold 23.5. 7b client event 1 client settlement (`legacy client-settlement script (client event 1)`): title `ExtraBold 16` y101 page 1 only; rule 138; meta 8.5 with `Doc No.: FSS/<CLIENT>/2026/001`; section bar h20 `Bold 9.5`; `drawTableRow` auto height lineGap 3.5; total box h75 `ExtraBold 19` + words `Medium 9`; footnote `PH-MB-40`.

**8. Remittance statement** (`legacy remittance-statement script (client event 2)`, 9 PDFs from `STATEMENTS[]`): letterhead business@<company domain>, CONFIDENTIAL footer. `MT+CP+14` date right `Bold 9.5`; +30 "To Whom It May Concern" `Bold 10`; +18 Subject `Bold 10.5`; paragraphs 10 / lineGap 7 / after 14; `drawDetailList` rh19 label `Regular 10 #555` w130 indent 18, value `SemiBold 10` prefixed `:  `. Signature `assets/alt sign.png` trimmed w500 → h46; seal w76 -6° at stampY-4; Director 2 `Bold 10` / COO `Medium 9 #666`.

**9. Registration summary** (`legacy registration-summary script (client event 5)`): date `MT+CP+14`; +34 title `ExtraBold 14` centred; +38 table cols 156/68/120/68/42/rest, pad 6/9, font 8.5 lineGap 2, header SemiBold `#f3f3f5` rule `#bdbdc2` 0.6, rows rule `#e8e8e8` 0.4, total Bold `#f7f7f8` rules `#1a1a1a` 0.8.

**10. Expense statement** (`legacy expense-statement script (client event 3)`): letterhead fonts 8/7.5, footer 7; title `ExtraBold 16`; `para` continued runs left-aligned lineGap 6; `drawTable` pad 10 min rh28 border `#d9d9d9` 0.6 header/total `#f3f4f6` `Bold 10`/`Regular 9.5`; `h2` `Bold 13`; `alt sign.png` h44; sign-off 4 lines. Bank typo `<bank-account>`.

**11. Board resolution** (`generate-board-resolution.js`): title `ExtraBold 15` charSpacing 1 at MT; date `SemiBold 9.5` right; preamble `Bold 9.5` justified lineGap 5; "RESOLVED:" `ExtraBold 10.5` underline; `para` `Regular 9.5 #333333` lineGap 5 md 1.1; signatory rows h40 name `SemiBold` at ML+26, line ML+340→right `#9a9a9a`; certification block h125 three cols `(CW-48)/3` gap 24, line at +15+84; footer centred Confidential only.

**12. MoUs (markdown-driven, own `parseMarkdown`: `#/##/###`, `---`, bullets, paragraphs, `|` tables; blocks before first `---` = centred cover; `## For …` starts signature section)**. v1 (client event 3 MoU, annual MoU and product-A MoUs, draft-mou; 45/55/55, no letterhead): `h1Centered` `ExtraBold 22 #1a202c` lineGap 4; `h2Centered` `Bold 16`; `h3Centered` `Bold 14 #4a5568`; `h1` `ExtraBold 20`; `h2` `Bold 15.5`; `h3` `SemiBold 13.5 #2d3748`; body 10.5 lineGap 6 `#2d3748` md 0.4; cover 11 centred; divider `#e2e8f0`; signatures two cols `CW/2-15` gap 30 `Bold 11` underline `#e2e8f0`, sign line 160 `#a0aec0`; no footer; draft watermark "DRAFT MOU - DO NOT SIGN" Bold 38 `#555555` opacity 0.14 -30° at `PH/2 ± PH/4.5`. the client event 3 summit MoU adds `Page i of n` `Regular 8 #a0aec0` centred `PH-MB+18`. v2 (`generate-organisation-mou.js` canonical; 45/50/50): `h1` `ExtraBold 14.5 #0f172a` lineGap 2 md 0.25/0.28; `h1Centered` `ExtraBold 18` lineGap 3; `h2Centered` `Bold 13 #1e293b`; `h2` `Bold 12 #1e293b` lineGap 1.5; `h3` `SemiBold 11 #334155`; body 10.2 `#334155` lineGap 5.6 md 0.32; bullets `•` `SemiBold #475569` lineGap 5.4 item md 0.18; cover 10.5; divider `#cbd5e1` 0.5; keep-together thresholds ORGANISATION DETAILS 450, WITNESS 260, DATA & PLATFORM USE 160, default 65. Tables: 2-col `[135,rest]` if header has "particular" else `[rest,130]`; pad 8/6.5; header 9.8 `#1e293b` white; rows 9.3 min h22 `#fff/#f8fafc`; net rows `#f1f5f9` Bold rule `#94a3b8` 0.75; closing rule `#cbd5e1` 0.75. Signature cards: two `roundedRect` w `CW/2-10` gap 20 h188 r5 `fillAndStroke('#f8fafc','#e2e8f0')`, title `Bold 10 #0f172a`, "Authorized Signatory" `Bold 9.5 #475569`, sign line 128 `#94a3b8`, fields Name/Designation/Date/Seal `Medium 9 #334155` values `SemiBold 8.5 #0f172a`. Footer rule `PH-34` `#e2e8f0`, `Page i of n` `Regular 7.5 #64748b` right. Variants: client events 22/23/19/2 body 9.2/5.8, h1 13.5, h1Centered 17, h2 11, h3 10, tables 8.8/8.3; client events 19/23 contact box h76, card h302 (Name/Designation/Contact/Date gap 25), running header page 2+ y28 `SemiBold 7.5 #64748b` + `#94a3b8`, three-part footer, client event 19 watermark "DRAFT DO NOT SIGN" Bold 36 opacity 0.12 at `PH/2 ± PH/4.2`; client event 2 signature from `signature.png` alpha-from-ink h40, seal h66 on party-1 card, card h330; draft-event card h205.

**13. Proposals**. Gen 1 (`generate-proposal.js`; clients S1, S2, client event 15 and client S5 add quotes): `h1` `ExtraBold 18` break<100 md 0.3/0.5; `h2` `Bold 13` break<70; `h3` `SemiBold 12`; `para` `Regular 11.5 #333333` justified lineGap 2.5 md 0.65; bullets 11.5 `•` at ML text ML+14 lineGap 1.5 item 0.32 list 0.45; divider `#e8e8e8` 0.4 skipped <110; contents numbers `SemiBold 11.5` rule `#f0f0f0`, subsections `Regular 11 #555` ML+22; cover title `SemiBold 24` at `MT+contentH*0.32` lineGap 8, "Prepared by" `Regular 12 #777`, company `Bold 12`; fee card shadow `roundedRect` +2 `#e0e0e0` then h84 `#1a1a1a`, "PLATFORM FEE" `SemiBold 9 #888888`, "4%" `ExtraBold 36` white, right +110 `Bold 12` + `Regular 10 #cccccc`; `infoRow` label `SemiBold 11 #555` w130; `costRow` h22 `#f8f8f8/#fff`, total `roundedRect #1a1a1a` `Bold 11.5`; total box h96 `ExtraBold 24`; sign-off two cols PROJECT CONTACT / AUTHORIZED SIGNATORY labels `SemiBold 9.5 #999` rows 11, divider `#e8e8e8`. Gen 2 (client events 16, 17, 5, 18, 19, 20, 21): body 11.5/3.5 (`para` 2.5); `drawFeeCard` h84 label 8.5 pct `ExtraBold 36` right +120 desc 9.5; `drawTable` pad 8/6 size 9.5 header SemiBold on `#1a1a1a`, rows `#f9f9f9/#fff`, last bold row → `#1a1a1a` bar, bold row above → `#d9d9d9`; `drawPriceCard` h108 `ExtraBold 32`; cover details `detRowH 22` label w150. Gen 3 (client events 12, 13, 14; 40/100/42 CP 12): `h1` `ExtraBold 16`, `h2` `Bold 12.5`, `h3` `SemiBold 11`, `para` 10.5/4.0 md 0.5, bullets 10/2.6, divider<45; badges h19 `#f1f5f9` border `#cbd5e1` `SemiBold 9.5 #334155`; callout `#f8fafc` border `#cbd5e1` bar 4 `#1a1a1a`; feature cards two-up `#f9fafb` border `#e5e7eb` title `Bold 10.5 #111827` desc 9.5 `#4b5563`; fee card h74 `ExtraBold 30`; table borders `#d0d0d0` 0.35 bold rows `#ececec` rows `#f4f4f4/#fff`; fee calculators (platform % + GST 18%, gateway 2% + GST 18%); cover divider y560 labels `SemiBold 10 #999` upper. Numbering `COX-<CODE>-YYYY-NN`. Collision: the client event 12 pricing and proposal scripts both write the same PDF.

**14. Pricing reports** (client event 4: 126, client event 7: 127, client event 11: 128, client event 12: 129, student-community, -100, general-events-1000): cover "Ticket Pricing Models" `SemiBold 24`, subtitle `Regular 14 #777`, Prepared for/by; "Document Details" centred (Report Number, Date `October 29, 2026`, Client); contents page; `calc(base)` fee 1.5–2% + GST, gateway 2% + GST, Delegate/Organiser Paid; table rh24 header `#1a1a1a` `Bold 10` rows `#f9f9f9/#fff` 9.5 totals black. `COX-REP-YYYY-NNN`.

**15–19.** Feature listing (`legacy feature-listing script (product A)`): gen-3 components, `h1` `ExtraBold 14.5`, `drawPricingTable`, `COX-DOC-2026-<CODE>`, 12 TOC sections. PRD/spec (client S6): `docTitle` `ExtraBold 19` + `SemiBold 12.5 #4a5568`; `h1` 14, `h2` 11.5; body 10/2.5 left; blockquote `#f8fafc` bar 3.5 `#2563eb`; numbered lists `Bold #2563eb`; table 9 pad 6 header `#1e293b` rows `#fff/#f8fafc` borders `#e2e8f0` header repeats. Playbook (product E): `h2` `Bold 13.5`, para 12/2.5, cover "PRODUCT DOCUMENT" `SemiBold 11 #999`, "<PRODUCT>" `ExtraBold 30`, accent rule 30–70%. Agreements (product D): `h1Centered` 20, `h2Centered` 14.5, `h3Centered` 13 `#555`, `h1` 17, `h2` 14, `h3` 12.5, body 11.5/3.5, fine print 9.5 `#777`, price table 320/200.28 header `Bold 11.5` values `ExtraBold 15` rules `#e0e0e0`; one header has a typo in the counterparty name. Portfolio (group entity, Figtree missing): logo h45 centred y12, header "CIN: <LLPIN> · …", rule y82, watermark w220 opacity 0.075, `h1` 17 `h2` 13.5 `h3` 12 `h4` 10.5 `h5` Medium 10 upper, para 11/4.5, cover subtitle `#c5a880`.

**20. Society-client header** (`legacy society-header script (society client)`, Figtree missing): PAD 24, `logo pad.png` 546×39, divider +24 `#cccccc`, `SOCIETY_BLUE #005BAA` bar 3 + `Bold 15`, para 12.5 `#444` lineGap 4, footer 9.5 `#aaa`.

**21. Product brand B proposals** (brand-B scripts; differ only in `Q{ref,date,validTill,clientName,studio}` at :32-38): 42/100/39 CP 14, letterhead business@<company domain>, no Confidential; `brand-B-logo.png` h48 centred above cover title; palette GREEN `#0A6B35`, TINT `#F2FAF5`, TINT_2 `#E4F3EA`, TINT_LINE `#CDE9D8`, INK `#141414`, BODY `#333333`, MUTED `#5B5B5B`, RULE `#E3E3E3`; `h1` `ExtraBold 18` + 28×2 green underline; `h2` `Bold 12.5`; para 10.5/3 continued runs; bullets 3.6pt green squares; `priceCard` r6 `ExtraBold 28` green badge pill; signatories Director 2 (COO, business@<company domain>), Director 1 (CEO, admin@<company domain>); `CO-QT-YYYY-NNN`.

**22. watermark.js**: `pdftoppm -png -r 150` → rebuild pages as images → overlay "DRAFT DO NOT SIGN" Helvetica-Bold 44 `#555555` opacity 0.14 -30° at `PH/2 ± PH/4.5` → rasterised output (text not selectable).

**23. Data-driven vs hard-coded**: markdown-driven = all MoUs, both agreements, portfolio. Everything else hard-coded (matching `.md` files were copy sources only). Only `generate-invoice.js` and the client event 1 invoice/DN/REC scripts compute "today".

**24. `refer/`**: older snapshots, byte-identical except the client event 23 MoU (lineGap 4.2) and the client event 3 summit MoU (no WITNESS handling). No relieving-letter generator exists; only `HTML/Relieving Letter.html` (Lato/Inter, 24px title, `alt sign.png` 80px, seal 120px, Director 2 / COO).

**25. HTML files**: `HTML/*.html` and `reference/*.html` are older hand-made Lato/`#6c757d` designs (`@page A4 margin 0`, body width 210mm padding `20px 30px` or `15px 30px`, grey table header, title 21px, body 12px, phone <phone>), not mirrors of the pdfkit output; `Offer Letter - <employee 1>.html` is an older internship offer; `Final Settlement Statement.html` is the HTML ancestor of the employee 6 (group-entity) table layout.

