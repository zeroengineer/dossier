import type { DocumentDetail, DocumentRendition, DocumentVersion, RenditionKind } from "@/api/types"

// Fake data from the example workspace only (Acme Events, Alex Example, example.com).

const MIME: Record<RenditionKind, string> = { pdf: "application/pdf", html: "text/html", md: "text/markdown", original: "application/pdf" }

function rendition(id: number, kind: RenditionKind, versionNo: number, overrides: Partial<DocumentRendition> = {}): DocumentRendition {
  const ext = kind === "original" ? "pdf" : kind
  return {
    id,
    kind,
    sha256: String(id).padStart(64, "a"),
    bytes: 2048 * id,
    mime: MIME[kind],
    filename: `invoice-v${versionNo}.${ext}`,
    displayName: `2026-04-01 Acme Client Invoice ACM-2026-0007 v${versionNo}.${ext}`,
    pageCount: kind === "pdf" ? 2 : null,
    createdAt: "2026-04-01T10:00:00.000Z",
    ...overrides,
  }
}

function version(id: number, versionNo: number, isCurrent: boolean, renditions: DocumentRendition[], note: string | null = null): DocumentVersion {
  return { id, versionNo, isCurrent, note, input: null, createdBy: "demo", createdAt: `2026-04-0${versionNo}T10:00:00.000Z`, renditions }
}

/** A generated invoice with two versions (v2 current, no HTML), entities and relations both ways. */
export const invoiceDoc: DocumentDetail = {
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
  businessLine: { id: 5, kind: "business_line", name: "Events" },
  engagement: null,
  issuingEntity: { id: 1, kind: "group_entity", name: "Acme Events Private Limited" },
  issuingBrandId: "acme",
  template: { id: "acme-invoice", version: 3 },
  renditions: [],
  versions: [
    version(11, 1, false, [rendition(101, "pdf", 1), rendition(102, "html", 1), rendition(103, "md", 1)], "First draft"),
    version(12, 2, true, [rendition(104, "pdf", 2), rendition(105, "md", 2)], "Fixed the due date"),
  ],
  entities: [
    { id: 3, kind: "client", name: "Acme Client Co", role: "party" },
    { id: 7, kind: "person", name: "Alex Example", role: "signatory" },
  ],
  relations: [
    {
      id: 1, type: "based_on", direction: "out",
      document: { id: "DOC-000004", type: "proposal", title: "Event services proposal", docNumber: "ACM-P-2026-0002", status: "Signed" },
      template: null, attrs: {},
    },
    {
      id: 2, type: "pays", direction: "in",
      document: { id: "DOC-000005", type: "receipt", title: "Payment receipt", docNumber: null, status: "Draft" },
      template: null, attrs: {},
    },
    { id: 3, type: "generated_from", direction: "out", document: null, template: { id: "acme-invoice", version: 3 }, attrs: {} },
  ],
  createdBy: "demo",
  createdAt: "2026-04-01T10:00:00.000Z",
}
invoiceDoc.renditions = invoiceDoc.versions[1]?.renditions ?? []

/** An uploaded document with no versions or files yet. */
export const emptyDoc: DocumentDetail = {
  ...invoiceDoc,
  id: "DOC-000003",
  title: "Signed letter scan",
  type: "letter",
  docNumber: null,
  numberSeries: null,
  amountMinor: null,
  currency: null,
  currentVersion: null,
  template: null,
  renditions: [],
  versions: [],
  entities: [],
  relations: [],
}

/** An uploaded Word file: one version with an `original` that cannot be previewed inline. */
export const uploadedDoc: DocumentDetail = {
  ...emptyDoc,
  id: "DOC-000006",
  title: "Venue agreement",
  currentVersion: 1,
  versions: [
    version(61, 1, true, [
      rendition(601, "original", 1, {
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "venue-agreement.docx",
        displayName: "2026-04-01 Venue agreement v1.docx",
      }),
    ]),
  ],
}

export const documentDetails: DocumentDetail[] = [invoiceDoc, emptyDoc, uploadedDoc]

/** Markdown served for `DOC-000001` (`version` is the version number asked for, or the current one). */
export const markdownOf = (versionNo: number) => `# Event services invoice\n\nVersion ${versionNo} of ACM-2026-0007.\n`
