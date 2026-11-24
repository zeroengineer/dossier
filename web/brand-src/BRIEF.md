# Design brief — Dossier

**Summary**: Dossier is a self-hosted document vault, generator and MCP server that keeps a small company's
records (invoices, contracts, letters) numbered, versioned and in order.
**Audience**: operations and finance staff of a small company. They see the mark in a browser tab (16 px favicon),
the app sidebar (24 px, white on near-black), on generated PDFs and in the README.
**Brand adjectives**: precise, quiet, trustworthy, modern.   **Avoid feeling**: bureaucratic, playful, "security product".
**Promise / big idea**: every document filed, numbered and findable; nothing lost, nothing loud.
**Competitive landscape**: document management and paperless tools lean on folders, filing cabinets, sheets with a
folded corner and text lines, magnifying glasses, clouds, shields/locks, paper planes and paper clips, mostly in blue
or teal. Open territory: a dark, restrained, typographic identity with one warm red accent and exact geometry.
**Mark type hypothesis**: combination mark (symbol + wordmark). Explore three different symbol types: a letterform D,
an abstract form, and a negative-space monogram in a container. The symbol must stand alone as favicon and sidebar mark.
**Must work on**: 16 px and 24 px white on near-black (`#141416`) with a single red accent `#e5484d`;
one colour on paper (black); favicon, web-app icons, sidebar, README header.
**Constraints**: only one accent colour (red `#e5484d`); the UI typeface is Manrope, so the wordmark uses Manrope
geometry, outlined as paths (no `<text>`). Avoid folder, magnifying glass, paper plane, generic document-with-lines,
shield.
**Success criteria**: recognisable at 16 px; reads as a D or as "a bound, closed record" at a glance; the one-colour
version loses nothing essential (red is an accent, never load-bearing); distinct from document-management clichés.
**Decision-maker**: the owner.   **Deliverables (this task)**: three concepts as black SVG (`viewBox 0 0 256 256`)
plus horizontal lockups and a concept sheet. The kit (favicon, icons, manifest, React logo) follows after approval (F20).
**Assumptions I made**:
- The wordmark is set from Manrope SemiBold outlines (SIL OFL 1.1, which allows use in a logo), slightly tightened.
- The red accent marks one part of the symbol (the binding, seal or tab); in one-colour use that part is simply black.
- The dark UI is the primary context, so concepts are judged mostly reversed (white on near-black) at small sizes.
