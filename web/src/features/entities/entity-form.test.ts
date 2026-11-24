import { describe, expect, it } from "vitest"
import { acmeCompany } from "@/test/fixtures-entities"
import { addAlias, entityFormSchema, formValues, NO_BRAND, parseAttrs, toEntityInput } from "./entity-form"
import { humanize, roleLabel } from "./labels"

describe("parseAttrs", () => {
  it("treats an empty box as no attributes", () => {
    expect(parseAttrs("  ")).toEqual({ ok: true, value: {} })
  })
  it("accepts a JSON object", () => {
    expect(parseAttrs('{"email": "a@example.com"}')).toEqual({ ok: true, value: { email: "a@example.com" } })
  })
  it("rejects invalid JSON, arrays, null and scalars", () => {
    for (const text of ["{email}", "[1]", "null", "3", '"x"']) expect(parseAttrs(text).ok).toBe(false)
  })
})

describe("entityFormSchema", () => {
  it("requires a kind and a name and a JSON-object attrs box", () => {
    const r = entityFormSchema.safeParse({ kind: "", name: "  ", aliases: [], brand: NO_BRAND, attrs: "[]" })
    expect(r.success).toBe(false)
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."))
    expect(paths.sort()).toEqual(["attrs", "kind", "name"])
  })
})

describe("toEntityInput", () => {
  it("builds a create body without empty optional fields", () => {
    expect(toEntityInput({ kind: "client", name: " Acme Client Co ", aliases: [], brand: NO_BRAND, attrs: "" }, null)).toEqual({
      kind: "client",
      name: "Acme Client Co",
    })
    expect(
      toEntityInput({ kind: "company", name: "Acme Studio", aliases: ["Studio"], brand: "acme-studio", attrs: '{"city":"Example City"}' }, null),
    ).toEqual({ kind: "company", name: "Acme Studio", aliases: ["Studio"], brand: "acme-studio", attrs: { city: "Example City" } })
  })

  it("on edit sends only new aliases, removed attribute keys as null and a cleared brand as null", () => {
    const values = { ...formValues(acmeCompany), aliases: ["Acme Events", "AEPL"], brand: NO_BRAND, attrs: '{"email": "billing@example.com"}' }
    expect(toEntityInput(values, acmeCompany)).toEqual({
      id: 1,
      name: "Acme Events Private Limited",
      aliases: ["AEPL"],
      attrs: { email: "billing@example.com", city: null },
      brand: null,
    })
  })

  it("on edit with unchanged values sends no aliases or attrs and keeps the brand", () => {
    expect(toEntityInput(formValues(acmeCompany), acmeCompany)).toEqual({ id: 1, name: "Acme Events Private Limited", attrs: acmeCompany.attrs, brand: "acme" })
  })
})

describe("addAlias and labels", () => {
  it("ignores blanks and case-insensitive duplicates", () => {
    expect(addAlias(["Acme"], "  ")).toEqual(["Acme"])
    expect(addAlias(["Acme"], "ACME")).toEqual(["Acme"])
    expect(addAlias(["Acme"], " Acme   Events ")).toEqual(["Acme", "Acme Events"])
  })
  it("humanizes enum values", () => {
    expect(humanize("business_line")).toBe("Business line")
    expect(roleLabel("employed_by")).toBe("employed by")
  })
})
