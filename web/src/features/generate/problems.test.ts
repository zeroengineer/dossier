import { describe, expect, it } from "vitest"
import type { TemplateDetail } from "@/api/types"
import { builtinTemplateDetails } from "@/test/fixtures-generate"
import { labelOfPath, toFieldProblems } from "./problems"

const { fields } = builtinTemplateDetails["invoice"] as TemplateDetail

describe("labelOfPath", () => {
  it("names fields, nested fields and list cells", () => {
    expect(labelOfPath(fields, "bankAccount")).toBe("Bank account")
    expect(labelOfPath(fields, "billTo.name")).toBe("Bill to (name)")
    expect(labelOfPath(fields, "items")).toBe("Items")
    expect(labelOfPath(fields, "items.2.amount")).toBe("Items row 3 amount")
    expect(labelOfPath(fields, "nope.x")).toBe("nope.x")
  })
})

describe("toFieldProblems", () => {
  it("maps row paths back to form rows and keeps the server's labels for missing fields", () => {
    const problems = toFieldProblems(
      fields,
      { missing: [{ name: "client", label: "Client" }], errors: [{ name: "items.1.amount", message: "not a money amount" }] },
      { items: [0, 3] },
    )
    expect(problems).toEqual([
      { path: "client", label: "Client", message: "is required", missing: true },
      { path: "items.3.amount", label: "Items row 4 amount", message: "not a money amount", missing: false },
    ])
  })
})
