import { describe, expect, it } from "vitest"
import type { TemplateField } from "@/api/types"
import { remapErrorPath, toInput } from "./to-input"

const field = (over: Partial<TemplateField> & Pick<TemplateField, "name">): TemplateField => ({
  label: over.name,
  type: "string",
  required: false,
  help: null,
  source: "ask",
  entityKind: null,
  choices: null,
  item: null,
  ...over,
})

// Same cases as the server's formToInput (src/web/routes/templates.js), with the values already nested by name.
describe("toInput", () => {
  it("keeps dotted names nested and blank scalars as '' (the server applies sources and defaults)", () => {
    const fields = [field({ name: "billTo.name" }), field({ name: "billTo.gstin" }), field({ name: "date", type: "date" })]
    expect(toInput(fields, { billTo: { name: "Demo Retail LLP", gstin: "" }, date: "" })).toEqual({
      input: { billTo: { name: "Demo Retail LLP", gstin: "" }, date: "" },
      errors: [],
      rowIndex: {},
    })
  })

  it("keeps money as the typed string", () => {
    expect(toInput([field({ name: "total", type: "money" })], { total: "₹1,20,000.50" }).input).toEqual({
      total: "₹1,20,000.50",
    })
  })

  it("drops list rows whose cells are all blank, and a list left empty", () => {
    const items = field({ name: "items", type: "array", item: { description: "text", amount: "money" } })
    expect(
      toInput([items], {
        items: [
          { description: "Stage", amount: "1000" },
          { description: " ", amount: "" },
          { description: "", amount: "250" },
        ],
      }).input,
    ).toEqual({ items: [{ description: "Stage", amount: "1000" }, { description: "", amount: "250" }] })
    expect(toInput([items], { items: [{ description: "", amount: "" }] }).input).toEqual({})
  })

  it("reads a list textarea as JSON or one entry per line, and blank as no value", () => {
    const docs = field({ name: "docs", type: "array" })
    expect(toInput([docs], { docs: " PAN card \n\nPhotograph\r\n" }).input).toEqual({ docs: ["PAN card", "Photograph"] })
    expect(toInput([docs], { docs: '[{ "label": "Bank", "value": "Example Bank" }]' }).input).toEqual({
      docs: [{ label: "Bank", value: "Example Bank" }],
    })
    expect(toInput([docs], { docs: "  " }).input).toEqual({})
  })

  it("reads an object textarea as JSON only", () => {
    const fees = field({ name: "fees", type: "object" })
    expect(toInput([fees], { fees: '{ "gstPercent": 18 }' })).toEqual({
      input: { fees: { gstPercent: 18 } },
      errors: [],
      rowIndex: {},
    })
    expect(toInput([fees], { fees: "gstPercent: 18" })).toEqual({
      input: { fees: "gstPercent: 18" },
      errors: [{ name: "fees", message: "expected a JSON object" }],
      rowIndex: {},
    })
  })

  it("reports invalid JSON and leaves the text in place", () => {
    const r = toInput([field({ name: "partner.signatory", type: "object" })], { partner: { signatory: "{ name" } })
    expect(r.input).toEqual({ partner: { signatory: "{ name" } })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]?.name).toBe("partner.signatory")
    expect(r.errors[0]?.message).toMatch(/^not valid JSON \(/)
  })

  it("sends switches as booleans and leaves out a switch with no value", () => {
    const fields = [field({ name: "seal", type: "boolean" }), field({ name: "watermark", type: "boolean" })]
    expect(toInput(fields, { seal: false, watermark: undefined }).input).toEqual({ seal: false })
  })

  it("leaves untyped line fields as typed text", () => {
    const address = field({ name: "billTo.address", type: null, help: "Address lines" })
    expect(toInput([address], { billTo: { address: "1 Example Street\nExample City" } }).input).toEqual({
      billTo: { address: "1 Example Street\nExample City" },
    })
  })

  it("does not change the form values", () => {
    const values = { items: [{ amount: "" }], docs: "a\nb" }
    toInput([field({ name: "items", type: "array", item: { amount: "money" } }), field({ name: "docs", type: "array" })], values)
    expect(values).toEqual({ items: [{ amount: "" }], docs: "a\nb" })
  })

  it("maps a server error on a sent row back to its form row when blank rows were dropped", () => {
    const items = field({ name: "items", type: "array", item: { description: "text", amount: "money" } })
    const { input, rowIndex } = toInput([items, field({ name: "billTo.name" })], {
      items: [
        { description: "", amount: "" },
        { description: "Stage", amount: "abc" },
        { description: " ", amount: "" },
        { description: "Sound", amount: "1000" },
      ],
      billTo: { name: "" },
    })
    expect(input["items"]).toEqual([{ description: "Stage", amount: "abc" }, { description: "Sound", amount: "1000" }])
    expect(rowIndex).toEqual({ items: [1, 3] })
    // The server reports the bad amount of the first row it got: form row 1 (the blank row 0 was not sent).
    expect(remapErrorPath("items.0.amount", rowIndex)).toBe("items.1.amount")
    expect(remapErrorPath("items.1", rowIndex)).toBe("items.3")
    expect(remapErrorPath("items", rowIndex)).toBe("items")
    expect(remapErrorPath("billTo.name", rowIndex)).toBe("billTo.name")
    expect(remapErrorPath("itemsExtra.0.x", rowIndex)).toBe("itemsExtra.0.x")
  })
})
