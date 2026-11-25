import type { SeriesEntry, WorkspaceFile } from "@/api/types"

// Example workspace data only (Acme Events, ACM- numbers, example.com).

/** series.json as stored (ids match the brand fixtures' series maps). */
export const seriesFile: SeriesEntry[] = [
  { id: "invoice-main", pattern: "ACM-{YYYY}-{####}", scope: "brand+year", start: 1 },
  { id: "receipt", pattern: "ACM-RC-{YYYY}-{####}", counter: "invoice-main", scope: "brand+year", note: "kept on save" },
  { id: "generic", pattern: "ACM-G-{###}", scope: "global" },
]

/** `GET /api/series/usage`. */
export const seriesUsage: Record<string, string[]> = {
  "invoice-main": ["acme: invoice", "acme-studio: invoice"],
  receipt: ["acme: receipt"],
}

/** workspace.json as stored. */
export const workspaceFile: WorkspaceFile = {
  name: "Example Workspace",
  defaultBrand: "acme",
  locale: { currencySymbol: "₹", currencyCode: "INR" },
  users: { demo: { clearance: "Confidential" }, intern: { clearance: "Internal" } },
  hierarchy: { routing: { Invoice: "Invoices and Receipts" } },
  seeds: "kept on save",
}

/** The ten default top-level folder names (`/api/meta` `hierarchy.topLevel`). */
export const defaultTopLevel = [
  "01 Company", "02 People", "03 Clients", "04 Vendors", "05 Products",
  "06 Finance", "07 Templates", "08 References", "09 Group Entities", "10 Restricted",
]
export const topKeys = ["company", "people", "clients", "vendors", "products", "finance", "templates", "references", "group", "restricted"]
