import type * as React from "react"
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { useMe } from "@/api/me"
import type { DashboardSummary } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { deltaOf, headlineInvoiced, type Delta } from "./figures"

const DELTA_ICON = { up: TrendingUpIcon, down: TrendingDownIcon, flat: MinusIcon } as const

/**
 * Change against the previous period: green up, red down (the only accent), muted when flat. `label` (what it is
 * compared with) follows the visible percentage as screen-reader text.
 */
function DeltaBadge({ delta, label }: { delta: Delta; label: string }) {
  const Icon = DELTA_ICON[delta.direction]
  const sign = delta.direction === "up" ? "+" : delta.direction === "down" ? "−" : ""
  return (
    <Badge
      variant="outline"
      data-direction={delta.direction}
      className={cn(
        "tabular-nums",
        delta.direction === "up" && "border-success/30 bg-success/10 text-success",
        delta.direction === "down" && "border-primary/30 bg-primary/10 text-primary",
        delta.direction === "flat" && "text-muted-foreground",
      )}
    >
      <Icon data-icon="inline-start" />
      {sign}
      {delta.percent}%
      {label ? <span className="sr-only"> {label}</span> : null}
    </Badge>
  )
}

interface KpiCardProps {
  label: string
  value: React.ReactNode
  caption: React.ReactNode
  delta?: Delta | null
  deltaLabel?: string
  testId: string
}

function KpiCard({ label, value, caption, delta, deltaLabel, testId }: KpiCardProps) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
        {delta ? (
          <CardAction>
            <DeltaBadge delta={delta} label={deltaLabel ?? ""} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{caption}</CardContent>
    </Card>
  )
}

/** The four headline figures. Deltas only where the API sends the previous period (documents, invoiced). */
export function KpiCards({ data }: { data: DashboardSummary }) {
  const { data: me } = useMe()
  const locale = me?.workspace.locale
  const workspaceCurrency = locale?.currencyCode
  const { kpis, previous, range } = data
  const days = range.days
  const prevPeriod = `the previous ${days} days`
  const num = (n: number) => n.toLocaleString(locale?.numberLocale || "en-IN")

  const docDelta = deltaOf(kpis.documents, previous.documents)

  const headline = headlineInvoiced(kpis.invoiced, workspaceCurrency)
  const currency = headline?.currency ?? workspaceCurrency ?? "INR"
  const prevSame = previous.invoiced.find((i) => i.currency === currency)
  const invoicedDelta = headline && prevSame ? deltaOf(headline.amountMinor, prevSame.amountMinor) : null
  const others = kpis.invoiced.filter((i) => i !== headline)

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        testId="kpi-documents"
        label="Documents"
        value={num(kpis.documents)}
        delta={docDelta}
        deltaLabel={`vs ${prevPeriod} (${num(previous.documents)})`}
        caption={`In the last ${days} days · ${num(previous.documents)} ${previous.documents === 1 ? "document" : "documents"} in ${prevPeriod}`}
      />
      <KpiCard
        testId="kpi-drafts"
        label="Drafts awaiting status"
        value={num(kpis.drafts)}
        caption="Documents still in Draft, all time"
      />
      <KpiCard
        testId="kpi-invoiced"
        label="Amount invoiced"
        value={formatMoney(headline?.amountMinor ?? 0, currency, locale)}
        delta={invoicedDelta}
        deltaLabel={prevSame ? `vs ${prevPeriod} (${formatMoney(prevSame.amountMinor, currency, locale)})` : undefined}
        caption={
          others.length
            ? `Also ${others.map((o) => formatMoney(o.amountMinor, o.currency, locale)).join(", ")}`
            : `Invoices in the last ${days} days, excluding superseded`
        }
      />
      <KpiCard
        testId="kpi-conflicts"
        label="Number conflicts"
        value={num(kpis.numberConflicts)}
        caption={kpis.numberConflicts ? "Documents sharing a number, all time" : "Every number is unique"}
      />
    </div>
  )
}

export function KpiCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-3 w-40" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
