import { describe, expect, it } from "vitest"
import { acmeFile, acmeResolved, studioFile, studioResolved } from "@/test/fixtures-brands"
import { meta } from "@/test/fixtures"
import { newBrandFieldFor, newBrandFile, parseRates, toBrandFile, toFormValues, type BrandContext } from "./brand-form"

const rootCtx: BrandContext = { resolved: acmeResolved, parent: null, fontWeights: meta.fontWeights }
const childCtx: BrandContext = { resolved: studioResolved, parent: acmeResolved, fontWeights: meta.fontWeights }

describe("brand form round trip", () => {
  it("saves an unchanged root brand as the same file", () => {
    const { body, problems } = toBrandFile(toFormValues(acmeFile, rootCtx), acmeFile)
    expect(problems).toEqual([])
    expect(body).toEqual(acmeFile)
  })

  it("saves an unchanged inheriting brand with only its overrides", () => {
    const values = toFormValues(studioFile, childCtx)
    // Lists the child does not override show the parent's rows, read-only.
    expect(values.registrations).toEqual({ override: false, rows: acmeResolved.registrations })
    const { body, problems } = toBrandFile(values, studioFile)
    expect(problems).toEqual([])
    expect(body).toEqual(studioFile)
  })

  it("adds nothing to a new brand's file, and a legal name change sends just that change", () => {
    const file = newBrandFile({
      id: "acme-two", inheritsFrom: "", legalName: "Acme Two", shortName: "Two", business: "Line 1", email: "two@example.com", phone: "", website: "",
    })
    const ctx: BrandContext = { resolved: { ...acmeResolved, id: "acme-two" }, parent: null, fontWeights: meta.fontWeights }
    const values = toFormValues(file, ctx)
    const same = toBrandFile(values, file)
    expect(same.problems).toEqual([])
    expect(same.body).toEqual(file)
    expect(same.body).not.toHaveProperty("tax")
    values.legalName = "Acme Two Private Limited"
    expect(toBrandFile(values, file).body).toEqual({ ...file, legalName: "Acme Two Private Limited" })
  })

  it("keeps the file's key order when the Advanced JSON changes a key", () => {
    const base = { ...acmeFile, layoutProfiles: { letter: { ML: 40 } }, zeta: 1 }
    const values = toFormValues(base, rootCtx)
    values.advanced = JSON.stringify({ zeta: 2, layoutProfiles: { letter: { ML: 50 } }, added: true })
    const { body } = toBrandFile(values, base)
    const expected = [...Object.keys(acmeFile).filter((k) => k !== "templateParams"), "layoutProfiles", "zeta", "added"]
    expect(Object.keys(body)).toEqual(expected)
    expect(body["zeta"]).toBe(2)
  })

  it("keeps keys the form does not edit and replaces them from the Advanced JSON", () => {
    const values = toFormValues({ ...acmeFile, custom: { a: 1 } }, rootCtx)
    expect(JSON.parse(values.advanced)).toEqual({ templateParams: { invoice: { showHsn: true } }, custom: { a: 1 } })
    values.advanced = JSON.stringify({ layoutProfiles: { compact: { margin: 20 } } })
    const { body } = toBrandFile(values, { ...acmeFile, custom: { a: 1 } })
    expect(body["layoutProfiles"]).toEqual({ compact: { margin: 20 } })
    expect(body).not.toHaveProperty("templateParams")
    expect(body).not.toHaveProperty("custom")
  })
})

describe("inheriting brands", () => {
  it("writes an overridden list and leaves blank scalars out", () => {
    const values = toFormValues(studioFile, childCtx)
    values.shortName = "  "
    values.registrations.override = true
    values.registrations.rows.push({ label: "GSTIN", value: "00AAAAA0000A0Z0" })
    values.footer.right = "p. {page}"
    const { body } = toBrandFile(values, studioFile)
    expect(body).not.toHaveProperty("shortName")
    expect(body["registrations"]).toEqual([...acmeResolved.registrations, { label: "GSTIN", value: "00AAAAA0000A0Z0" }])
    expect(body["footer"]).toEqual({ right: "p. {page}" })
  })

  it("drops an emptied contacts map instead of writing {}", () => {
    const values = toFormValues(studioFile, childCtx)
    values.contacts = []
    const { body } = toBrandFile(values, studioFile)
    expect(body).not.toHaveProperty("contacts")
  })

  it("uses the parent's colour as the inherited palette value", () => {
    const values = toFormValues(studioFile, childCtx)
    expect(values.palette.find((p) => p.key === "accent")).toEqual({ key: "accent", value: "#e5484d", useDefault: true })
  })
})

describe("root brands", () => {
  it("writes required scalars even when blank so the server reports them", () => {
    const values = toFormValues(acmeFile, rootCtx)
    values.legalName = ""
    values.addresses.business = ""
    const { body } = toBrandFile(values, acmeFile)
    expect(body["legalName"]).toBe("")
    expect((body["addresses"] as { business: string[] }).business).toEqual([])
  })

  it("ticks palette defaults for unset colours and leaves them out", () => {
    const values = toFormValues(acmeFile, rootCtx)
    expect(values.palette.find((p) => p.key === "ink")).toEqual({ key: "ink", value: "#1a1a1a", useDefault: true })
    const ink = values.palette.findIndex((p) => p.key === "ink")
    values.palette[ink] = { key: "ink", value: "#ABCDEF", useDefault: false }
    const accent = values.palette.findIndex((p) => p.key === "accent")
    values.palette[accent]!.useDefault = true
    const { body } = toBrandFile(values, acmeFile)
    expect(body["palette"]).toEqual({ ink: "#abcdef" })
  })

  it("drops blank rows and maps server indexes back to the form rows", () => {
    const values = toFormValues(acmeFile, rootCtx)
    values.registrations.rows.splice(0, 0, { label: " ", value: "" })
    const { body, fieldFor } = toBrandFile(values, acmeFile)
    expect(body["registrations"]).toHaveLength(2)
    expect(fieldFor("registrations.1.value")).toBe("registrations.rows.2.value")
    expect(fieldFor("registrations")).toBe("registrations.rows.root")
  })
})

describe("problems found before saving", () => {
  it("reports bad and duplicate map keys, bad colours, bad rates and bad JSON on their fields", () => {
    const values = toFormValues(acmeFile, rootCtx)
    values.strings.push({ key: "bad key", value: "x" }, { key: "confidential", value: "y" })
    values.palette[0]!.useDefault = false
    values.palette[0]!.value = "red"
    values.tax.modes.rows[1]!.rates = "IGST = lots"
    values.advanced = "{"
    const { problems } = toBrandFile(values, acmeFile)
    expect(problems.map((p) => p.field)).toEqual(["tax.modes.rows.1.rates", "strings.2.key", "strings.3.key", "palette.0.value", "advanced"])
  })

  it("refuses Advanced keys that a tab edits", () => {
    const values = toFormValues(acmeFile, rootCtx)
    values.advanced = JSON.stringify({ legalName: "x" })
    expect(toBrandFile(values, acmeFile).problems).toEqual([{ field: "advanced", message: '"legalName" is edited on its own tab' }])
  })
})

describe("server error paths", () => {
  const { fieldFor } = toBrandFile(toFormValues(acmeFile, rootCtx), acmeFile)
  it.each([
    ["legalName", "legalName"],
    ["addresses.business", "addresses.business"],
    ["contacts.hr.email", "contacts.1.email"],
    ["contacts", "contacts.root"],
    ["defaultSignatory.letter", "defaultSignatory.1.value"],
    ["series.invoice", "series.0.value"],
    ["palette.accent", `palette.${Object.keys(acmeResolved.palette).indexOf("accent")}.value`],
    ["fonts.bold", "fonts.bold"],
    ["assets.seal", "assets.seal"],
    ["signatories.1.title", "signatories.rows.1.title"],
    ["letterhead.lines.1", "letterhead.rows.1.value"],
    ["tax.defaultMode", "tax.defaultMode"],
    ["tax.modes.1.rates.0.rate", "tax.modes.rows.1.rates"],
    ["templateParams.invoice", "advanced"],
    ["(root)", null],
    ["inheritsFrom", null],
  ])("%s -> %s", (server, field) => {
    expect(fieldFor(server)).toBe(field)
  })
})

describe("rates", () => {
  it("reads fractions and percentages", () => {
    expect(parseRates("CGST = 0.09\nSGST (9%) = 9%\n")).toEqual([{ label: "CGST", rate: 0.09 }, { label: "SGST (9%)", rate: 0.09 }])
    expect(parseRates("IGST")).toBeNull()
  })
})

describe("new brand", () => {
  const blank = { id: "", inheritsFrom: "", legalName: "", shortName: "", business: "", email: "", phone: "", website: "" }
  it("writes every required key for a root brand", () => {
    expect(newBrandFile({ ...blank, id: "acme-two", legalName: "Acme Two", shortName: "Two", business: "Line 1\n\nLine 2", email: "two@example.com" })).toEqual({
      id: "acme-two", legalName: "Acme Two", shortName: "Two", addresses: { business: ["Line 1", "Line 2"] }, contacts: { default: { email: "two@example.com" } },
    })
  })
  it("writes only what was filled in for an inheriting brand", () => {
    expect(newBrandFile({ ...blank, id: "acme-north", inheritsFrom: "acme", shortName: "North" })).toEqual({ id: "acme-north", inheritsFrom: "acme", shortName: "North" })
  })
  it("maps server paths onto the dialog's fields", () => {
    expect(newBrandFieldFor("addresses.business")).toBe("business")
    expect(newBrandFieldFor("contacts.default.phone")).toBe("phone")
    expect(newBrandFieldFor("legalName")).toBe("legalName")
    expect(newBrandFieldFor("(root)")).toBeNull()
  })
})
