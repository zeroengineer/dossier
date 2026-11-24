import { describe, expect, it } from "vitest"
import type { TemplateField, TemplateMetaField } from "@/api/types"
import { builtinTemplateDetails } from "@/test/fixtures-generate"
import { fieldKind, fieldsToZod, listText, mustFill, toFormValues, unofferedChoices } from "./schema"

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

/** zod issues as `path: message`. */
function issues(fields: TemplateField[], values: Record<string, unknown>, meta: TemplateMetaField[] = []) {
  const r = fieldsToZod(fields, meta).safeParse(values)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
}

describe("fieldKind", () => {
  it("maps every field type to its input", () => {
    expect(fieldKind(field({ name: "a", type: "string" }))).toBe("string")
    expect(fieldKind(field({ name: "a", type: "text" }))).toBe("text")
    expect(fieldKind(field({ name: "a", type: "date" }))).toBe("date")
    expect(fieldKind(field({ name: "a", type: "money" }))).toBe("money")
    expect(fieldKind(field({ name: "a", type: "number" }))).toBe("number")
    expect(fieldKind(field({ name: "a", type: "boolean" }))).toBe("boolean")
    expect(fieldKind(field({ name: "a", type: "enum", choices: ["x"] }))).toBe("enum")
    expect(fieldKind(field({ name: "a", type: "entity", entityKind: "client" }))).toBe("entity")
    expect(fieldKind(field({ name: "a", type: "array", item: { amount: "money" } }))).toBe("rows")
    expect(fieldKind(field({ name: "a", type: "array" }))).toBe("structured")
    expect(fieldKind(field({ name: "a", type: "object" }))).toBe("structured")
    expect(fieldKind(field({ name: "a", type: null, help: "Address lines (a list or text with line breaks)" }))).toBe(
      "lines",
    )
    expect(fieldKind(field({ name: "a", type: null }))).toBe("string")
  })

  it("prefers the entity kind, then the choices, over the type", () => {
    expect(fieldKind(field({ name: "a", type: null, entityKind: "person" }))).toBe("entity")
    expect(fieldKind(field({ name: "a", type: "string", choices: ["A", "B"] }))).toBe("enum")
    // An enum whose brand list does not resolve has no choices: a plain input.
    expect(fieldKind(field({ name: "a", type: "enum", choices: null }))).toBe("string")
  })
})

describe("mustFill", () => {
  it("enforces required fields that only the user can fill", () => {
    expect(mustFill(field({ name: "a", required: true, source: "ask" }), [])).toBe(true)
    expect(mustFill(field({ name: "a", required: true, source: undefined }), [])).toBe(true)
    expect(mustFill(field({ name: "c", required: true, source: "entity:client", entityKind: "client" }), [])).toBe(true)
  })

  it("leaves required fields with a source or default to the server", () => {
    expect(mustFill(field({ name: "d", required: true, source: "today" }), [])).toBe(false)
    expect(mustFill(field({ name: "billTo.name", required: true, source: "client.name" }), [])).toBe(false)
    expect(mustFill(field({ name: "s", required: true, source: "signatory" }), [])).toBe(false)
    expect(mustFill(field({ name: "a", required: true }), [{ name: "a", default: "x" }])).toBe(false)
    expect(mustFill(field({ name: "a", required: false }), [])).toBe(false)
  })
})

describe("fieldsToZod", () => {
  it("string, text, date, money, number, enum, entity, lines: text, required when only the user can fill it", () => {
    for (const type of ["string", "text", "date", "money", "number"] as const) {
      const f = [field({ name: "a", type, required: true })]
      expect(issues(f, { a: "" }), type).toEqual(["a: Required"])
      expect(issues(f, { a: "   " }), type).toEqual(["a: Required"])
      expect(issues(f, { a: "12" }), type).toEqual([])
      expect(issues([field({ name: "a", type })], { a: "" }), type).toEqual([])
    }
    const e = [field({ name: "e", type: "enum", choices: ["none", "igst"], required: true })]
    expect(issues(e, { e: "" })).toEqual(["e: Required"])
    expect(issues(e, { e: "igst" })).toEqual([])
    const c = [field({ name: "client", type: "entity", entityKind: "client", source: "entity:client", required: true })]
    expect(issues(c, { client: "" })).toEqual(["client: Required"])
    expect(issues(c, { client: "Demo Retail LLP" })).toEqual([])
    const l = [field({ name: "address", type: null, help: "Address lines", required: true, source: "ask" })]
    expect(issues(l, { address: "" })).toEqual(["address: Required"])
    expect(issues(l, { address: "1 Example Street\nExample City" })).toEqual([])
  })

  it("does not check amounts, numbers or dates (the server coerces them)", () => {
    const f = [
      field({ name: "m", type: "money" }),
      field({ name: "n", type: "number" }),
      field({ name: "d", type: "date" }),
    ]
    expect(issues(f, { m: "₹1,20,000.50", n: "abc", d: "10/02/2026" })).toEqual([])
  })

  it("does not require a required field with another source", () => {
    expect(issues([field({ name: "date", type: "date", required: true, source: "today" })], { date: "" })).toEqual([])
  })

  it("boolean: optional true/false", () => {
    const f = [field({ name: "seal", type: "boolean" })]
    expect(issues(f, { seal: true })).toEqual([])
    expect(issues(f, { seal: false })).toEqual([])
    expect(issues(f, {})).toEqual([])
    expect(issues(f, { seal: "yes" })).toHaveLength(1)
  })

  it("array with item: rows of strings; required means at least one row with a value", () => {
    const f = [field({ name: "items", type: "array", item: { description: "text", amount: "money" }, required: true })]
    expect(issues(f, { items: [{ description: "", amount: "" }] })).toEqual(["items: Add at least one row"])
    expect(issues(f, { items: [] })).toEqual(["items: Add at least one row"])
    expect(issues(f, { items: [{ description: "", amount: "" }, { description: "Stage", amount: "" }] })).toEqual([])
    const optional = [field({ name: "items", type: "array", item: { amount: "money" } })]
    expect(issues(optional, { items: [{ amount: "" }] })).toEqual([])
  })

  it("array without item: one entry per line or JSON; invalid JSON is an error", () => {
    const f = [field({ name: "docs", type: "array" })]
    expect(issues(f, { docs: "" })).toEqual([])
    expect(issues(f, { docs: "PAN card\nPhotograph" })).toEqual([])
    expect(issues(f, { docs: '["PAN card"]' })).toEqual([])
    expect(issues(f, { docs: "[1, 2" })[0]).toMatch(/^docs: not valid JSON/)
    expect(issues([field({ name: "docs", type: "array", required: true })], { docs: " " })).toEqual(["docs: Required"])
  })

  it("object: JSON only", () => {
    const f = [field({ name: "fees", type: "object" })]
    expect(issues(f, { fees: "" })).toEqual([])
    expect(issues(f, { fees: '{ "gstPercent": 18 }' })).toEqual([])
    expect(issues(f, { fees: "gstPercent: 18" })).toEqual(["fees: expected a JSON object"])
    expect(issues(f, { fees: "{ gstPercent" })[0]).toMatch(/^fees: not valid JSON/)
  })

  it("nests dotted names like the form values", () => {
    const f = [field({ name: "billTo.name", required: true }), field({ name: "billTo.gstin" })]
    expect(issues(f, { billTo: { name: "", gstin: "" } })).toEqual(["billTo.name: Required"])
    expect(issues(f, { billTo: { name: "Demo Retail LLP", gstin: "" } })).toEqual([])
  })

  it("accepts the initial values of every built-in template except for the fields only the user can fill", () => {
    for (const t of Object.values(builtinTemplateDetails)) {
      const values = toFormValues(t.fields, t.meta.fields)
      const expected = t.fields
        .filter((f) => mustFill(f, t.meta.fields))
        .map((f) => `${f.name}: ${fieldKind(f) === "rows" ? "Add at least one row" : "Required"}`)
      expect(issues(t.fields, values, t.meta.fields).sort(), t.id).toEqual(expected.sort())
    }
  })
})

describe("toFormValues", () => {
  const fields = [
    field({ name: "client", type: "entity", entityKind: "client", source: "entity:client" }),
    field({ name: "billTo.name" }),
    field({ name: "billTo.address", type: null, help: "Address lines (a list or text with line breaks)" }),
    field({ name: "items", type: "array", item: { description: "text", amount: "money" } }),
    field({ name: "docs", type: "array" }),
    field({ name: "fees", type: "object" }),
    field({ name: "seal", type: "boolean" }),
    field({ name: "watermark", type: "boolean" }),
    field({ name: "taxMode", type: "enum", choices: ["none", "igst"] }),
    field({ name: "consent", type: "boolean", required: true }),
  ]
  const meta: TemplateMetaField[] = [{ name: "seal", type: "boolean", default: true }]

  it("starts empty: one blank row per list, switches at the template default", () => {
    expect(toFormValues(fields, meta)).toEqual({
      client: "",
      billTo: { name: "", address: "" },
      items: [{ description: "", amount: "" }],
      docs: "",
      fees: "",
      seal: true,
      watermark: undefined,
      taxMode: "",
      consent: false,
    })
  })

  it("fills from a previous input (regenerate)", () => {
    const values = toFormValues(fields, meta, {
      client: { id: 4, name: "Demo Retail LLP" },
      billTo: { name: "Demo Retail LLP", address: ["3 Market Lane", "Example City 000000"] },
      items: [{ description: "Stage", amount: 120000 }],
      docs: ["PAN card", "Photograph"],
      fees: { gstPercent: 18 },
      seal: false,
      taxMode: "igst",
    })
    expect(values).toEqual({
      client: "Demo Retail LLP",
      billTo: { name: "Demo Retail LLP", address: "3 Market Lane\nExample City 000000" },
      items: [{ description: "Stage", amount: "120000" }],
      docs: "PAN card\nPhotograph",
      fees: JSON.stringify({ gstPercent: 18 }, null, 2),
      seal: false,
      watermark: undefined,
      taxMode: "igst",
      consent: false,
    })
  })

  it("listText: lines for a list of strings, JSON otherwise", () => {
    expect(listText(undefined)).toBe("")
    expect(listText("as typed")).toBe("as typed")
    expect(listText(["a", "b"])).toBe("a\nb")
    expect(listText([{ label: "Bank", value: "Example Bank" }])).toBe('[\n  {\n    "label": "Bank",\n    "value": "Example Bank"\n  }\n]')
  })
})

describe("unofferedChoices", () => {
  it("lists choice fields whose value is not among the choices", () => {
    const fields = [
      field({ name: "taxMode", type: "enum", choices: ["none"] }),
      field({ name: "weight", type: "enum", choices: ["Medium", "Bold"] }),
      field({ name: "nested.mode", type: "enum", choices: ["a"] }),
      field({ name: "plain", type: "string" }),
    ]
    const values = { taxMode: "igst", weight: "Bold", nested: { mode: "" }, plain: "x" }
    expect(unofferedChoices(fields, values).map((f) => f.name)).toEqual(["taxMode"])
  })
})

