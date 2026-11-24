import { describe, expect, it } from "vitest"
import { client, invoices, vaultRoot } from "@/test/fixtures-vault"
import { ancestorIds, countDocuments, findNode, folderCrumbs, normalizeNodeId, vaultHref } from "./paths"

describe("vault paths", () => {
  it("normalizes the splat into a node id", () => {
    expect(normalizeNodeId(undefined)).toBe("")
    expect(normalizeNodeId("/03//events/")).toBe("03/events")
  })

  it("builds encoded /vault links", () => {
    expect(vaultHref("")).toBe("/vault")
    expect(vaultHref("03/events/acme")).toBe("/vault/03/events/acme")
    expect(vaultHref("03/a b/c?d#e")).toBe("/vault/03/a%20b/c%3Fd%23e")
  })

  it("lists ancestors outermost first", () => {
    expect(ancestorIds("")).toEqual([])
    expect(ancestorIds("03")).toEqual([])
    expect(ancestorIds("03/events/acme")).toEqual(["03", "03/events"])
  })

  it("finds nodes and counts documents in a subtree", () => {
    expect(findNode(vaultRoot, invoices.id)).toBe(invoices)
    expect(findNode(vaultRoot, "03/missing")).toBeNull()
    expect(countDocuments(client)).toBe(3)
  })

  it("names breadcrumbs from the root tree, else from the path", () => {
    expect(folderCrumbs(client, vaultRoot).map((c) => c.name)).toEqual(["03 Clients", "Events Line", "Example Client LLP"])
    expect(folderCrumbs(client).map((c) => c.id)).toEqual(["03", "03/events", "03/events/example-client"])
    const slashy = { ...client, name: "A/B LLP", path: "03 Clients/Events Line/A/B LLP" }
    expect(folderCrumbs(slashy)).toEqual([{ id: client.id, name: "A/B LLP" }])
  })
})
