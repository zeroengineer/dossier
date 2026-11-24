import type { DocumentSummary, SearchResult } from "@/api/types"

// Fake search results for the example workspace (Acme Events, Alex Example, ACM- numbers).

function summary(id: string, overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id,
    type: "Invoice",
    title: "Event services invoice",
    status: "Sent",
    sensitivity: "Internal",
    party: { id: 3, kind: "client", name: "Acme Client Co", type: "Client" },
    docNumber: null,
    numberSeries: null,
    numberConflict: false,
    docDate: "2026-04-01",
    dueDate: null,
    amountMinor: null,
    currency: null,
    currentVersion: 1,
    updatedAt: "2026-04-02T10:00:00.000Z",
    ...overrides,
  }
}

/** A result with a number hit, a text hit with a snippet, a related document and two entities. */
export const searchResult: SearchResult = {
  hits: [
    {
      document: summary("DOC-000001", { docNumber: "ACM-2026-0007", title: "Event services invoice" }),
      score: 0,
      match: "number",
      snippet: null,
    },
    {
      document: summary("DOC-000004", { type: "Letter", title: "Venue confirmation", status: "Draft", docNumber: null }),
      score: 3.2,
      match: "text",
      snippet: "…the [Acme] Events team confirms the venue for…",
    },
  ],
  related: [
    {
      document: summary("DOC-000002", { type: "Quote", title: "Event services quote", status: "Signed", docNumber: "ACM-Q-2026-0003" }),
      via: { kind: "document", relation: "quote_for", from: "DOC-000001" },
    },
    {
      document: summary("DOC-000006", { type: "Contract", title: "Services agreement", status: "Signed" }),
      via: { kind: "entity", relation: "party", from: 3 },
    },
  ],
  entities: [
    { id: 3, kind: "client", name: "Acme Client Co", brand: null, aliases: ["Acme Client"], matched: null },
    { id: 7, kind: "person", name: "Alex Example", brand: null, aliases: ["Acme contact"], matched: "Acme contact" },
  ],
}

export const emptySearchResult: SearchResult = { hits: [], related: [], entities: [] }
