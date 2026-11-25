import { describe, expect, it } from "vitest"
import { seriesFile } from "@/test/fixtures-settings"
import { BLANK_SERIES, toSeriesFormValues, toSeriesList } from "./series-form"

describe("series form", () => {
  it("round-trips series.json unchanged, keeping keys the form does not edit", () => {
    const values = toSeriesFormValues(seriesFile)
    expect(values.series[1]).toEqual({ id: "receipt", pattern: "ACM-RC-{YYYY}-{####}", scope: "brand+year", start: "", counter: "invoice-main" })
    const { body, problems } = toSeriesList(values, seriesFile)
    expect(problems).toEqual([])
    expect(body).toEqual(seriesFile)
  })

  it("shows a counter naming the series itself as its own counter and leaves it out on save", () => {
    const list = [{ id: "a", pattern: "A-{##}", counter: "a" }]
    const values = toSeriesFormValues(list)
    expect(values.series[0]?.counter).toBe("")
    expect(toSeriesList(values, list).body).toEqual([{ id: "a", pattern: "A-{##}" }])
  })

  it("trims values, drops blank rows, parses start and reports a bad start on its row", () => {
    const { body, problems } = toSeriesList(
      {
        series: [
          BLANK_SERIES,
          { id: " x ", pattern: " X-{##} ", scope: "", start: "5", counter: "" },
          { ...BLANK_SERIES, id: "y", pattern: "Y-{##}", start: "one" },
        ],
      },
      [],
    )
    expect(body).toEqual([{ id: "x", pattern: "X-{##}", start: 5 }, { id: "y", pattern: "Y-{##}" }])
    expect(problems).toEqual([{ field: "series.2.start", message: "must be a whole number" }])
  })

  it("maps server row indexes (as sent) back to form rows", () => {
    const { fieldFor } = toSeriesList(
      { series: [BLANK_SERIES, { ...BLANK_SERIES, id: "a", pattern: "A-{##}" }, BLANK_SERIES, { ...BLANK_SERIES, id: "b", pattern: "B" }] },
      [],
    )
    expect(fieldFor("1.pattern")).toBe("series.3.pattern")
    expect(fieldFor("0.counter")).toBe("series.1.counter")
    expect(fieldFor("0")).toBe("series.1.id")
    expect(fieldFor("5.pattern")).toBeNull()
    expect(fieldFor("(root)")).toBeNull()
  })
})
