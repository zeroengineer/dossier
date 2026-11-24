import type { DashboardDays, DashboardSummary, DocumentSummary } from "@/api/types"

// Fake data from the example workspace only (Acme Events, Alex Example, ACM- numbers).

const day = (base: string, offset: number) => {
  const [y, m, d] = base.split("-").map(Number)
  const date = new Date(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + offset)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const TO = "2026-04-30"

export const recentDocuments: DocumentSummary[] = [
  {
    id: "DOC-000003",
    type: "Invoice",
    title: "Invoice for stage design",
    status: "Sent",
    sensitivity: "Internal",
    party: { id: 1, kind: "client", name: "Alex Example", type: "Client" },
    docNumber: "ACM-INV-2026-003",
    numberSeries: "invoice",
    numberConflict: false,
    docDate: "2026-04-28",
    dueDate: "2026-05-28",
    amountMinor: 1250000,
    currency: "INR",
    currentVersion: 1,
    updatedAt: "2026-04-28T10:00:00.000Z",
  },
  {
    id: "DOC-000002",
    type: "Letter",
    title: "Engagement letter",
    status: "Draft",
    sensitivity: "Internal",
    party: null,
    docNumber: null,
    numberSeries: null,
    numberConflict: false,
    docDate: null,
    dueDate: null,
    amountMinor: null,
    currency: null,
    currentVersion: 1,
    updatedAt: "2026-04-20T09:00:00.000Z",
  },
]

/** A dashboard answer for `days`, shaped like src/services/dashboard.js dashboardSummary. */
export function dashboardFixture(days: DashboardDays = 30, overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  const from = day(TO, -(days - 1))
  const timeline = Array.from({ length: days }, (_, i) => ({ date: day(from, i), count: i === days - 3 ? 2 : i === days - 11 ? 1 : 0 }))
  const documents = timeline.reduce((s, t) => s + t.count, 0)
  return {
    range: { days, from, to: TO },
    kpis: {
      documents,
      drafts: 4,
      invoiced: [
        { currency: "INR", amountMinor: 1250000 },
        { currency: "USD", amountMinor: 50000 },
      ],
      numberConflicts: 1,
    },
    previous: {
      from: day(from, -days),
      to: day(from, -1),
      documents: 2,
      invoiced: [{ currency: "INR", amountMinor: 2500000 }],
    },
    timeline,
    recent: recentDocuments,
    counters: [{ seriesId: "invoice", seriesIds: ["invoice"], key: "acme:2026", value: 4 }],
    warnings: [
      {
        code: "NUMBER_CONFLICT",
        message: "DOC-000003: number ACM-INV-2026-003 is also used by another document of series invoice",
        href: "/documents/DOC-000003",
      },
    ],
    ...overrides,
  }
}
