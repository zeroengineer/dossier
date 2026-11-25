import type { DocumentSummary, EntityDetail, EntitySummary } from "@/api/types"

// Fake master list of the example workspace (Acme Events, Alex Example, example.com).

const stamp = { createdAt: "2026-03-01T09:00:00.000Z", updatedAt: "2026-04-02T12:30:00.000Z" }

export const acmeCompany: EntityDetail = {
  id: 1,
  kind: "company",
  name: "Acme Events Private Limited",
  key: "acme events private limited",
  brand: "acme",
  attrs: { email: "accounts@example.com", city: "Example City" },
  aliases: ["Acme Events"],
  relations: [{ id: 1, role: "employed_by", direction: "in", entity: { id: 2, kind: "person", name: "Alex Example" }, attrs: { since: "2025-01-01" } }],
  documentCount: 3,
  ...stamp,
}

export const alexPerson: EntityDetail = {
  id: 2,
  kind: "person",
  name: "Alex Example",
  key: "alex example",
  brand: null,
  attrs: {},
  aliases: ["Alex"],
  relations: [{ id: 1, role: "employed_by", direction: "out", entity: { id: 1, kind: "company", name: "Acme Events Private Limited" }, attrs: {} }],
  documentCount: 0,
  ...stamp,
}

export const acmeClient: EntityDetail = {
  id: 3,
  kind: "client",
  name: "Acme Client Co",
  key: "acme client co",
  brand: null,
  attrs: {},
  aliases: ["ACC"],
  relations: [],
  documentCount: 2,
  ...stamp,
}

export const exampleVendor: EntityDetail = {
  id: 4,
  kind: "vendor",
  name: "Example Supplies",
  key: "example supplies",
  brand: null,
  attrs: {},
  aliases: [],
  relations: [],
  documentCount: 1,
  ...stamp,
}

export const entityDetails: EntityDetail[] = [acmeCompany, alexPerson, acmeClient, exampleVendor]

export const summaryOf = (e: EntityDetail): EntitySummary => ({
  id: e.id,
  kind: e.kind,
  name: e.name,
  brand: e.brand,
  aliases: e.aliases,
  matched: null,
  documentCount: e.documentCount,
})

export const entitySummaries: EntitySummary[] = entityDetails.map(summaryOf)

/** Documents naming Acme Events (the company). */
export const acmeDocuments: DocumentSummary[] = [
  {
    id: "DOC-000001",
    type: "invoice",
    title: "Event services invoice",
    status: "Sent",
    sensitivity: "Internal",
    party: { id: 3, kind: "client", name: "Acme Client Co", type: "Client" },
    docNumber: "ACM-2026-0007",
    numberSeries: "acme-invoice",
    numberConflict: false,
    docDate: "2026-04-01",
    dueDate: "2026-04-15",
    amountMinor: 12345600,
    currency: "INR",
    currentVersion: 2,
    updatedAt: "2026-04-02T10:00:00.000Z",
  },
  {
    id: "DOC-000003",
    type: "letter",
    title: "Venue confirmation letter",
    status: "Draft",
    sensitivity: "Public",
    party: null,
    docNumber: null,
    numberSeries: null,
    numberConflict: false,
    docDate: "2026-03-20",
    dueDate: null,
    amountMinor: null,
    currency: null,
    currentVersion: 1,
    updatedAt: "2026-03-20T10:00:00.000Z",
  },
]
