// Loaded lazily (React.lazy in the dashboard page) so Recharts lives in its own `charts` chunk. The page renders the
// chart's text alternative (ChartSummary) itself, so screen readers get the figures even before this chunk loads.
import { useId } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { useMe } from "@/api/me"
import type { DashboardDays } from "@/api/types"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { DEFAULT_LOCALE, formatDate, parseDate } from "@/lib/format"
import type { ChartPoint } from "./figures"

const config = {
  count: { label: "Documents", color: "var(--chart-1)" },
} satisfies ChartConfig

export default function DocumentsChart({ points, days }: { points: ChartPoint[]; days: DashboardDays }) {
  const { data: me } = useMe()
  const reducedMotion = useReducedMotion()
  const fillId = `fill-documents-${useId().replace(/:/g, "")}`
  const numberLocale = me?.workspace.locale.numberLocale || DEFAULT_LOCALE.numberLocale
  const tick = (value: string) => {
    const d = parseDate(value)
    return d ? new Intl.DateTimeFormat(numberLocale, { day: "numeric", month: "short" }).format(d) : value
  }
  const label = (point: ChartPoint | undefined) => {
    if (!point) return ""
    const from = formatDate(point.date, "medium", me?.workspace.locale)
    return point.end === point.date ? from : `Week of ${from}`
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" data-testid="documents-chart">
      <AreaChart data={points} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.45} />
            <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={days === 7 ? 8 : 32}
          tickFormatter={tick}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, payload) => label(payload[0]?.payload as ChartPoint | undefined)}
            />
          }
        />
        <Area
          dataKey="count"
          type="monotone"
          fill={`url(#${fillId})`}
          stroke="var(--color-count)"
          strokeWidth={2}
          isAnimationActive={!reducedMotion}
        />
      </AreaChart>
    </ChartContainer>
  )
}
