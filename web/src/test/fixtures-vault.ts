import type { TreeDocument, TreeNode } from "@/api/types"

// Example workspace folder tree (Acme Events, ACM- numbers) for the Vault tests.

const doc = (over: Partial<TreeDocument> & Pick<TreeDocument, "id" | "displayName">): TreeDocument => ({
  type: "Invoice",
  status: "Draft",
  sensitivity: "Internal",
  docDate: "2026-07-14",
  ...over,
})

const folder = (id: string, path: string, children: TreeNode[] = [], documents: TreeDocument[] = []): TreeNode => ({
  id,
  name: path.split("/").at(-1) ?? path,
  path,
  children,
  documents,
})

export const invoices = folder("03/events/example-client/invoices-and-receipts", "03 Clients/Events Line/Example Client LLP/Invoices and Receipts", [], [
  doc({ id: "DOC-000001", displayName: "2026-07-14_ExampleClientLLP_Invoice_ACM-2026-0001_v1.pdf", status: "Sent" }),
  doc({ id: "DOC-000002", displayName: "2026-08-02_ExampleClientLLP_Invoice_ACM-2026-0002_v1.pdf", docDate: "2026-08-02", sensitivity: "Confidential" }),
])

export const proposals = folder("03/events/example-client/proposals-and-pricing", "03 Clients/Events Line/Example Client LLP/Proposals and Pricing", [], [
  doc({ id: "DOC-000003", displayName: "2026-06-01_ExampleClientLLP_Proposal_v2.pdf", type: "Proposal", docDate: null }),
])

export const client = folder("03/events/example-client", "03 Clients/Events Line/Example Client LLP", [invoices, proposals])
export const eventsLine = folder("03/events", "03 Clients/Events Line", [client])
export const clients = folder("03", "03 Clients", [eventsLine])
export const legal = folder("01/legal-and-registration", "01 Company/Legal and Registration")
export const company = folder("01", "01 Company", [legal])

export const vaultRoot: TreeNode = { id: "", name: "", path: "", children: [company, clients], documents: [] }
