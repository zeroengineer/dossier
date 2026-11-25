// series.json <-> the numbering form. Every value is a string in the form; on save values are trimmed, blank rows are
// dropped, a blank scope or counter is left out (the server's defaults: scope brand+year, the series' own counter),
// and keys the form does not edit are kept from the stored series with the same id. The server reports problems at
// `<index>.<key>` of the list as sent; `fieldFor` maps those indexes back onto form rows.
import type { SeriesEntry } from "@/api/types"

export const SERIES_KEYS = ["id", "pattern", "scope", "start", "counter"] as const
type SeriesKey = (typeof SERIES_KEYS)[number]

export type SeriesRow = Record<SeriesKey, string>

export interface SeriesFormValues {
  series: SeriesRow[]
}

export const BLANK_SERIES: SeriesRow = { id: "", pattern: "", scope: "", start: "", counter: "" }

export interface SeriesBuild {
  body: SeriesEntry[]
  /** Client-side problems, on form field names (`series.2.start`). */
  problems: Array<{ field: string; message: string }>
  /** Server path (`3.pattern`, `3`) -> form field name, or null when it is not a row field. */
  fieldFor: (serverPath: string) => string | null
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")

export function toSeriesFormValues(list: SeriesEntry[]): SeriesFormValues {
  return {
    series: list.map((s) => ({
      id: str(s.id),
      pattern: str(s.pattern),
      scope: str(s.scope),
      start: str(s.start),
      // A counter naming the series itself is the same as none.
      counter: s.counter === s.id ? "" : str(s.counter),
    })),
  }
}

export function toSeriesList(values: SeriesFormValues, stored: SeriesEntry[]): SeriesBuild {
  const byId = new Map(stored.map((s) => [s.id, s]))
  const problems: SeriesBuild["problems"] = []
  const kept: number[] = []
  const body: SeriesEntry[] = []
  values.series.forEach((raw, i) => {
    const r = Object.fromEntries(SERIES_KEYS.map((k) => [k, raw[k].trim()])) as SeriesRow
    if (SERIES_KEYS.every((k) => r[k] === "")) return
    const extra = Object.fromEntries(Object.entries(byId.get(r.id) ?? {}).filter(([k]) => !(SERIES_KEYS as readonly string[]).includes(k)))
    const out: SeriesEntry = { ...extra, id: r.id, pattern: r.pattern }
    if (r.scope) out.scope = r.scope
    if (r.start !== "") {
      if (/^\d+$/.test(r.start)) out.start = Number(r.start)
      else problems.push({ field: `series.${i}.start`, message: "must be a whole number" })
    }
    if (r.counter && r.counter !== r.id) out.counter = r.counter
    kept.push(i)
    body.push(out)
  })
  const fieldFor = (serverPath: string): string | null => {
    const m = /^(\d+)(?:\.(\w+))?$/.exec(serverPath)
    if (!m) return null
    const row = kept[Number(m[1])]
    if (row === undefined) return null
    const key = (SERIES_KEYS as readonly string[]).includes(m[2] ?? "") ? m[2] : "id"
    return `series.${row}.${key}`
  }
  return { body, problems, fieldFor }
}
