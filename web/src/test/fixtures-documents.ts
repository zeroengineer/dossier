import type { DocumentPartyOption, DocumentSummary } from "@/api/types"

// Fake data from the example workspace only (Acme Events, Alex Example, ACM- numbers).

export const acmeEvents: DocumentPartyOption = { id: 7, kind: "client", name: "Acme Events" }
export const alexExample: DocumentPartyOption = { id: 9, kind: "person", name: "Alex Example" }

const base: DocumentSummary = {
  id: "DOC-000001",
  type: "Invoice",
  title: "Stage invoice",
  status: "Sent",
  sensitivity: "Internal",
  party: { ...acmeEvents, type: "Client" },
  docNumber: "ACM-2026-001",
  numberSeries: "invoice",
  numberConflict: false,
  docDate: "2026-04-01",
  dueDate: null,
  amountMinor: 12345600,
  currency: "INR",
  currentVersion: 1,
  updatedAt: "2026-04-01T10:00:00.000Z",
}

/** Three hand-written documents followed by generated ones: 45 in all, newest first. */
export const documentRows: DocumentSummary[] = [
  base,
  {
    ...base,
    id: "DOC-000002",
    type: "Letter",
    title: "Venue confirmation letter",
    status: "Draft",
    party: { ...alexExample, type: "Person" },
    docNumber: "ACM-2026-001",
    numberSeries: "letter",
    numberConflict: true,
    docDate: "2026-03-15",
    amountMinor: null,
    currency: null,
  },
  { ...base, id: "DOC-000003", title: "Catering quotation", type: "Quotation", status: "Paid", party: null, docNumber: null, docDate: null },
  ...Array.from({ length: 42 }, (_, i): DocumentSummary => {
    const n = String(i + 4).padStart(6, "0")
    return { ...base, id: `DOC-${n}`, title: `Invoice ${i + 4}`, docNumber: `ACM-2025-${n}`, docDate: "2025-12-01" }
  }),
]
