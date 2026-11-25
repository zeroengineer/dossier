import { DASHBOARD_DAYS, type DashboardDays, type DashboardInvoiced } from "@/api/types"

export const DEFAULT_DAYS: DashboardDays = 30

/** The `?days=` search param as a range the API accepts, else the default. */
export function parseDays(value: string | null): DashboardDays {
  const n = Number(value)
  return (DASHBOARD_DAYS as readonly number[]).includes(n) ? (n as DashboardDays) : DEFAULT_DAYS
}

export interface Delta {
  direction: "up" | "down" | "flat"
  /** Whole-percent change against the previous period, unsigned. */
  percent: number
}

/**
 * Change of `current` against `previous`, both straight from the API. Null when there is nothing to compare with
 * (previous is zero), so no percentage is ever made up.
 */
export function deltaOf(current: number, previous: number): Delta | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  const change = ((current - previous) / previous) * 100
  const percent = Math.round(Math.abs(change))
  if (percent === 0) return { direction: "flat", percent: 0 }
  return { direction: change > 0 ? "up" : "down", percent }
}

/** The invoiced total to headline: the workspace currency if invoiced in the range, else the first one listed. */
export function headlineInvoiced(invoiced: DashboardInvoiced[], workspaceCurrency: string | undefined): DashboardInvoiced | null {
  return invoiced.find((i) => i.currency === workspaceCurrency) ?? invoiced[0] ?? null
}

export interface ChartPoint {
  /** First day of the bucket (YYYY-MM-DD). */
  date: string
  /** Last day of the bucket; equals `date` for daily points. */
  end: string
  count: number
}

/**
 * The timeline as chart points: one per day, or one per 7-day bucket for the 90-day view. Buckets are anchored at the
 * range end, so only the oldest bucket can be short and the latest week is always complete.
 */
export function chartPoints(timeline: Array<{ date: string; count: number }>, days: DashboardDays): ChartPoint[] {
  if (days < 90) return timeline.map((t) => ({ date: t.date, end: t.date, count: t.count }))
  const out: ChartPoint[] = []
  for (let end = timeline.length; end > 0; end -= 7) {
    const week = timeline.slice(Math.max(0, end - 7), end)
    const first = week[0]
    const last = week.at(-1)
    if (!first || !last) continue
    out.unshift({ date: first.date, end: last.date, count: week.reduce((s, t) => s + t.count, 0) })
  }
  return out
}

/** Total and busiest bucket of the chart, for its text alternative. `peak` is null when there were no documents. */
export function summarizePoints(points: ChartPoint[]): { total: number; peak: ChartPoint | null } {
  let total = 0
  let peak: ChartPoint | null = null
  for (const p of points) {
    total += p.count
    if (p.count > 0 && (!peak || p.count > peak.count)) peak = p
  }
  return { total, peak }
}
