import { useMe } from "@/api/me"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

interface MoneyProps {
  /** Amount in minor units (paise, cents): 123456 is 1,234.56. */
  amountMinor: number
  /** ISO currency code; defaults to the workspace currency. */
  currency?: string
  className?: string
}

/** An amount in minor units, grouped for the workspace locale (`en-IN` by default). Never float-divides. */
export function Money({ amountMinor, currency, className }: MoneyProps) {
  const { data: me } = useMe()
  const locale = me?.workspace.locale
  const code = currency ?? locale?.currencyCode ?? "INR"
  return <span className={cn("tabular-nums", className)}>{formatMoney(amountMinor, code, locale)}</span>
}
