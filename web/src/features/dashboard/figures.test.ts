import { describe, expect, it } from "vitest"
import { chartPoints, deltaOf, headlineInvoiced, parseDays } from "./figures"

describe("parseDays", () => {
  it("accepts 7, 30 and 90 and falls back to 30", () => {
    expect(parseDays("7")).toBe(7)
    expect(parseDays("90")).toBe(90)
    expect(parseDays(null)).toBe(30)
    expect(parseDays("14")).toBe(30)
    expect(parseDays("abc")).toBe(30)
  })
})

describe("deltaOf", () => {
  it("gives the rounded change against the previous period", () => {
    expect(deltaOf(3, 2)).toEqual({ direction: "up", percent: 50 })
    expect(deltaOf(1, 4)).toEqual({ direction: "down", percent: 75 })
    expect(deltaOf(5, 5)).toEqual({ direction: "flat", percent: 0 })
  })

  it("gives nothing when there is no previous figure to compare with", () => {
    expect(deltaOf(3, 0)).toBeNull()
    expect(deltaOf(0, 0)).toBeNull()
  })
})

describe("headlineInvoiced", () => {
  const invoiced = [
    { currency: "EUR", amountMinor: 100 },
    { currency: "INR", amountMinor: 500 },
  ]
  it("prefers the workspace currency, else the first one", () => {
    expect(headlineInvoiced(invoiced, "INR")?.currency).toBe("INR")
    expect(headlineInvoiced(invoiced, "USD")?.currency).toBe("EUR")
    expect(headlineInvoiced([], "INR")).toBeNull()
  })
})

describe("chartPoints", () => {
  const timeline = Array.from({ length: 90 }, (_, i) => ({ date: `d${i}`, count: 1 }))

  it("keeps one point per day below 90 days", () => {
    expect(chartPoints(timeline.slice(0, 7), 7)).toHaveLength(7)
  })

  it("buckets the 90-day view by week back from the range end (only the oldest bucket is short)", () => {
    const points = chartPoints(timeline, 90)
    expect(points).toHaveLength(13)
    expect(points[0]).toEqual({ date: "d0", end: "d5", count: 6 })
    expect(points[1]).toEqual({ date: "d6", end: "d12", count: 7 })
    expect(points.at(-1)).toEqual({ date: "d83", end: "d89", count: 7 })
    expect(points.reduce((s, p) => s + p.count, 0)).toBe(90)
  })
})
