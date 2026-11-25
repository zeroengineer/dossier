import { describe, expect, it } from "vitest"
import type { WorkspaceFile } from "@/api/types"
import { defaultTopLevel, workspaceFile } from "@/test/fixtures-settings"
import { lostClearances, toWorkspaceFile, toWorkspaceFormValues } from "./workspace-form"

describe("workspace form", () => {
  it("round-trips workspace.json unchanged, keeping keys the form does not edit", () => {
    const values = toWorkspaceFormValues(workspaceFile)
    expect(values.hierarchy.topLevel).toHaveLength(10)
    expect(values.users).toEqual([{ id: "demo", clearance: "Confidential" }, { id: "intern", clearance: "Internal" }])
    const { body, problems } = toWorkspaceFile(values, workspaceFile, defaultTopLevel)
    expect(problems).toEqual([])
    expect(body).toEqual(workspaceFile)
  })

  it("leaves blank locale values out and removes groups emptied by that", () => {
    const file: WorkspaceFile = { name: "W", defaultBrand: "acme", locale: { currencyCode: "INR", dateFormats: { short: "DD/MM/YYYY" } } }
    const values = toWorkspaceFormValues(file)
    values.locale.dateFormats.short = " "
    values.locale.currencyWords.major = "Dollars"
    const { body } = toWorkspaceFile(values, file, defaultTopLevel)
    expect(body.locale).toEqual({ currencyCode: "INR", currencyWords: { major: "Dollars" } })
  })

  it("sends all ten top-level names once one is set, blanks keeping their default", () => {
    const values = toWorkspaceFormValues(workspaceFile)
    values.hierarchy.topLevel[2] = { value: "03 Customers" }
    const { body } = toWorkspaceFile(values, workspaceFile, defaultTopLevel)
    expect(body.hierarchy?.topLevel).toEqual(defaultTopLevel.map((n, i) => (i === 2 ? "03 Customers" : n)))
  })

  it("drops blank routing and user rows, reports missing and duplicate keys, keeps a blank clearance blank", () => {
    const values = toWorkspaceFormValues(workspaceFile)
    values.hierarchy.routing = [{ type: "", value: "" }, { type: "NDA", value: "Agreements" }, { type: "NDA", value: "Other" }, { type: "", value: "Other" }]
    values.users = [{ id: "demo", clearance: "" }, { id: "", clearance: "" }, { id: "bad id", clearance: "Public" }, { id: "demo", clearance: "Public" }]
    const { body, problems } = toWorkspaceFile(values, workspaceFile, defaultTopLevel)
    expect(body.hierarchy?.routing).toEqual({ NDA: "Agreements" })
    expect(body.users).toEqual({ demo: {} })
    expect(problems.map((p) => p.field)).toEqual(["hierarchy.routing.2.type", "hierarchy.routing.3.type", "users.2.id", "users.3.id"])
  })

  it("rewrites routing values that start with a renamed custom top-level name", () => {
    const custom = defaultTopLevel.map((n, i) => (i === 5 ? "06 Money" : n))
    const file: WorkspaceFile = {
      name: "W",
      defaultBrand: "acme",
      hierarchy: { topLevel: custom, routing: { "Bank Statement": "06 Money/Bank Statements", Ledger: "06 Money", Tax: "06 Finance/Tax Returns", NDA: "Agreements" } },
    }
    const values = toWorkspaceFormValues(file)
    values.hierarchy.topLevel[5] = { value: "06 Accounts" }
    const { body, problems } = toWorkspaceFile(values, file, defaultTopLevel)
    expect(problems).toEqual([])
    expect(body.hierarchy?.routing).toEqual({
      "Bank Statement": "06 Accounts/Bank Statements", Ledger: "06 Accounts", Tax: "06 Finance/Tax Returns", NDA: "Agreements",
    })
    // Clearing every name goes back to the defaults, and routes follow too.
    values.hierarchy.topLevel = values.hierarchy.topLevel.map(() => ({ value: "" }))
    expect(toWorkspaceFile(values, file, defaultTopLevel).body.hierarchy?.routing?.["Ledger"]).toBe("06 Finance")
  })

  it("flags duplicate top-level names, names with a slash and routing types that differ only in case", () => {
    const values = toWorkspaceFormValues(workspaceFile)
    values.hierarchy.topLevel[0] = { value: "02 People" }
    values.hierarchy.topLevel[2] = { value: "03 A/B" }
    values.hierarchy.routing.push({ type: " invoice ", value: "Other" })
    const { problems } = toWorkspaceFile(values, workspaceFile, defaultTopLevel)
    expect(problems).toEqual([
      { field: "hierarchy.topLevel.0.value", message: 'duplicate folder name "02 People"' },
      { field: "hierarchy.topLevel.2.value", message: 'must not contain "/"' },
      { field: "hierarchy.routing.1.type", message: 'duplicate document type "invoice"' },
    ])
  })

  it("lists the clearance levels the acting user would lose", () => {
    const levels = ["Public", "Internal", "Confidential", "Restricted"]
    const file = (users: WorkspaceFile["users"]): WorkspaceFile => ({ name: "W", defaultBrand: "acme", users })
    expect(lostClearances(file({ demo: { clearance: "Public" } }), "demo", "Confidential", levels)).toEqual(["Internal", "Confidential"])
    expect(lostClearances(file({}), "demo", "Restricted", levels)).toEqual(["Restricted"])
    expect(lostClearances(file({ demo: {} }), "demo", "Confidential", levels)).toEqual([])
    expect(lostClearances(file({ demo: { clearance: "Restricted" } }), "demo", "Confidential", levels)).toEqual([])
  })

  it("maps server paths onto fields: locale, top-level slots, routing by type, users by id", () => {
    const values = toWorkspaceFormValues(workspaceFile)
    values.hierarchy.routing = [{ type: "", value: "" }, { type: "Debit Note", value: "10 Restricted" }]
    values.users = [{ id: "", clearance: "" }, { id: "intern", clearance: "Restricted" }, { id: "demo", clearance: "Confidential" }]
    const { fieldFor } = toWorkspaceFile(values, workspaceFile, defaultTopLevel)
    expect(fieldFor("name")).toBe("name")
    expect(fieldFor("locale.currencyCode")).toBe("locale.currencyCode")
    expect(fieldFor("locale.dateFormats.short")).toBe("locale.dateFormats.short")
    expect(fieldFor("hierarchy.topLevel")).toBe("hierarchy.topLevel.root")
    expect(fieldFor("hierarchy.topLevel.4")).toBe("hierarchy.topLevel.4.value")
    expect(fieldFor("hierarchy.routing.Debit Note")).toBe("hierarchy.routing.1.value")
    expect(fieldFor("users.intern.clearance")).toBe("users.1.clearance")
    expect(fieldFor("users.senior.clearance")).toBeNull()
    expect(fieldFor("(root)")).toBeNull()
  })
})
