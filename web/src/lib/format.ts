import type { Locale } from "@/api/types"

/**
 * The fallbacks used before `/api/me` has loaded (or when it has no locale). They mirror the server's defaults for
 * `workspace.json` `locale` in src/workspace/schemas.js (`currencyCode` INR, `numberLocale` en-IN): change both together.
 */
export const DEFAULT_LOCALE = { numberLocale: "en-IN", currencyCode: "INR" } as const

const DEFAULT_NUMBER_LOCALE = DEFAULT_LOCALE.numberLocale

/**
 * Format an amount held in minor units (paise, cents) without float division: the integer is split into major and
 * minor parts with BigInt, the major part is grouped for the locale, and the minor part is appended as-is.
 */
export function formatMoney(amountMinor: number | bigint, currency: string, locale?: Pick<Locale, "numberLocale">, minorDigits = 2): string {
  const numberLocale = locale?.numberLocale || DEFAULT_NUMBER_LOCALE
  const value = typeof amountMinor === "bigint" ? amountMinor : BigInt(Math.trunc(amountMinor))
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(minorDigits)
  const major = abs / base
  const minor = abs % base

  const parts = new Intl.NumberFormat(numberLocale, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
    .formatToParts(major)
  const decimal = new Intl.NumberFormat(numberLocale).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? "."
  let out = ""
  for (const part of parts) {
    if (part.type === "fraction" || part.type === "decimal") continue
    out += part.value
    if (part.type === "integer" && parts.filter((p) => p.type === "integer").at(-1) === part && minorDigits > 0) {
      out += decimal + minor.toString().padStart(minorDigits, "0")
    }
  }
  return negative ? `-${out}` : out
}

/** Parse a date-only (`2026-04-01`) or ISO timestamp string into a Date; date-only values are read as local dates. */
export function parseDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export type DateStyle = "short" | "medium" | "long" | "datetime"

export function formatDate(value: string | Date, style: DateStyle = "medium", locale?: Pick<Locale, "numberLocale">): string {
  const date = typeof value === "string" ? parseDate(value) : value
  if (!date) return typeof value === "string" ? value : ""
  const numberLocale = locale?.numberLocale || DEFAULT_NUMBER_LOCALE
  const options: Intl.DateTimeFormatOptions =
    style === "short" ? { day: "2-digit", month: "2-digit", year: "numeric" }
      : style === "long" ? { day: "numeric", month: "long", year: "numeric" }
        : style === "datetime" ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
          : { day: "numeric", month: "short", year: "numeric" }
  return new Intl.DateTimeFormat(numberLocale, options).format(date)
}
