import { describe, expect, it } from "vitest"
import { parseDocumentsSearch, toListParams, toSearchParams } from "./search-params"

describe("documents search params", () => {
  it("reads filters and paging, dropping malformed values", () => {
    const s = parseDocumentsSearch(new URLSearchParams("type=Invoice&status=Sent&partyId=7&from=2026-01-01&to=2026-1-5&page=3&size=50"))
    expect(s).toEqual({ type: "Invoice", status: "Sent", partyId: 7, from: "2026-01-01", to: undefined, page: 3, size: 50 })
    expect(parseDocumentsSearch(new URLSearchParams("partyId=x&page=0&size=13&type="))).toEqual({
      type: undefined,
      status: undefined,
      partyId: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      size: 20,
    })
  })

  it("writes only non-default values and round-trips", () => {
    const s = parseDocumentsSearch(new URLSearchParams("status=Paid&page=2"))
    expect(toSearchParams(s).toString()).toBe("status=Paid&page=2")
    expect(toSearchParams({ page: 1, size: 20 }).toString()).toBe("")
  })

  it("maps page and size to limit and offset", () => {
    expect(toListParams({ type: "Invoice", page: 3, size: 50 })).toEqual({
      type: "Invoice",
      status: undefined,
      partyId: undefined,
      from: undefined,
      to: undefined,
      limit: 50,
      offset: 100,
    })
  })
})
