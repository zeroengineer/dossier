import { describe, expect, it } from "vitest"
import { DEFAULT_LOCALE, formatDate, formatMoney, parseDate } from "./format"

const inr = { numberLocale: "en-IN" }

describe("formatMoney", () => {
  it("groups minor units for en-IN without float division", () => {
    expect(formatMoney(12345678901, "INR", inr)).toBe("₹12,34,56,789.01")
    expect(formatMoney(5, "INR", inr)).toBe("₹0.05")
    expect(formatMoney(0, "INR", inr)).toBe("₹0.00")
  })

  it("keeps the sign of negative amounts and handles amounts beyond float precision", () => {
    expect(formatMoney(-150, "INR", inr)).toBe("-₹1.50")
    expect(formatMoney(900719925474099312n, "INR", inr)).toBe("₹9,00,71,99,25,47,40,993.12")
  })

  it("uses the locale's grouping for other locales", () => {
    expect(formatMoney(123456789, "USD", { numberLocale: "en-US" })).toBe("$1,234,567.89")
  })
})

describe("dates", () => {
  it("reads date-only strings as local dates", () => {
    const d = parseDate("2026-04-01")
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(3)
    expect(d?.getDate()).toBe(1)
    expect(parseDate("not a date")).toBeNull()
  })

  it("formats in the workspace locale", () => {
    expect(formatDate("2026-04-01", "short", inr)).toBe("01/04/2026")
    expect(formatDate("2026-04-01", "long", inr)).toBe("1 April 2026")
    expect(formatDate("garbage", "medium", inr)).toBe("garbage")
  })
})

describe("DEFAULT_LOCALE", () => {
  it("is the fallback when no workspace locale is given", () => {
    expect(DEFAULT_LOCALE).toEqual({ numberLocale: "en-IN", currencyCode: "INR" })
    expect(formatMoney(12345678, DEFAULT_LOCALE.currencyCode)).toBe("₹1,23,456.78")
    expect(formatDate("2026-04-01", "short")).toBe("01/04/2026")
  })

  it("is the only place the app spells the fallback locale or currency", () => {
    const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/test/**"], {
      query: "?raw", import: "default", eager: true,
    })
    const offenders = Object.entries(sources)
      .filter(([path, text]) => path !== "/src/lib/format.ts" && /["'`](en-IN|INR)["'`]/.test(text))
      .map(([path]) => path)
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(offenders).toEqual([])
  })
})
