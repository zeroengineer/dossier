import { lazy, Suspense, useEffect } from "react"
import { FilePlus2Icon, FilesIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { useDashboard } from "@/api/dashboard"
import { useMe } from "@/api/me"
import { DASHBOARD_DAYS, type DashboardDays, type DashboardSummary } from "@/api/types"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { chartPoints, DEFAULT_DAYS, parseDays, summarizePoints, type ChartPoint } from "@/features/dashboard/figures"
import { KpiCards, KpiCardsSkeleton } from "@/features/dashboard/kpi-cards"
import { RecentDocuments } from "@/features/dashboard/recent-documents"
import { SeriesCounters } from "@/features/dashboard/series-counters"
import { WarningsCard } from "@/features/dashboard/warnings-card"
import { formatDate } from "@/lib/format"

// Recharts is only needed here: its own chunk, fetched when the page mounts (in parallel with the dashboard data)
// rather than once the data has arrived and the chart first renders.
const loadChart = () => import("@/features/dashboard/documents-chart")
const DocumentsChart = lazy(loadChart)

function RangeToggle({ days, onChange }: { days: DashboardDays; onChange: (days: DashboardDays) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={String(days)}
      onValueChange={(v) => v && onChange(parseDays(v))}
      aria-label="Date range"
    >
      {DASHBOARD_DAYS.map((d) => (
        <ToggleGroupItem key={d} value={String(d)} aria-label={`Last ${d} days`}>
          {d} days
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** The chart as text for screen readers: a one-line summary and a table of every point (visually hidden). */
function ChartSummary({ points, weekly }: { points: ChartPoint[]; weekly: boolean }) {
  const { data: me } = useMe()
  const locale = me?.workspace.locale
  const num = (n: number) => n.toLocaleString(locale?.numberLocale || "en-IN")
  const { total, peak } = summarizePoints(points)
  const bucket = (p: ChartPoint) => (weekly ? `Week of ${formatDate(p.date, "medium", locale)}` : formatDate(p.date, "medium", locale))
  return (
    <div className="sr-only" data-testid="documents-chart-summary">
      <p>
        {num(total)} {total === 1 ? "document" : "documents"} in this range.
        {peak ? ` Busiest ${weekly ? "week" : "day"}: ${bucket(peak)}, with ${num(peak.count)}.` : ""}
      </p>
      <table>
        <caption>Documents per {weekly ? "week" : "day"}</caption>
        <thead>
          <tr>
            <th scope="col">{weekly ? "Week" : "Day"}</th>
            <th scope="col">Documents</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{bucket(p)}</th>
              <td>{num(p.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartCard({ data }: { data: DashboardSummary }) {
  const { data: me } = useMe()
  const locale = me?.workspace.locale
  const { range } = data
  const points = chartPoints(data.timeline, range.days)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents over time</CardTitle>
        <CardDescription>
          {formatDate(range.from, "medium", locale)} to {formatDate(range.to, "medium", locale)}
          {range.days === 90 ? ", by week" : ", by day"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartSummary points={points} weekly={range.days === 90} />
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <DocumentsChart points={points} days={range.days} />
        </Suspense>
      </CardContent>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading dashboard">
      <KpiCardsSkeleton />
      <Skeleton className="h-80 rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg lg:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  const days = parseDays(params.get("days"))
  const { data, error, isPending, isPlaceholderData, refetch } = useDashboard(days)
  useEffect(() => {
    void loadChart()
  }, [])

  const setDays = (next: DashboardDays) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        if (next === DEFAULT_DAYS) out.delete("days")
        else out.set("days", String(next))
        return out
      },
      { replace: true },
    )

  const noDocuments = data ? data.recent.length === 0 : false

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={me ? `${me.workspace.name} at a glance.` : "Your workspace at a glance."}
        actions={<RangeToggle days={days} onChange={setDays} />}
      />
      {isPending ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <ErrorState error={error} title="The dashboard could not load" onRetry={() => void refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-4" aria-busy={isPlaceholderData} data-testid="dashboard">
          <KpiCards data={data} />
          {noDocuments ? (
            <EmptyState
              icon={FilesIcon}
              title="No documents yet"
              description="Generate a document from a template or upload an existing file to see activity here."
              className="min-h-72 flex-none"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link to="/generate">
                      <FilePlus2Icon data-icon="inline-start" />
                      Generate
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/upload">Upload</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <ChartCard data={data} />
              <RecentDocuments documents={data.recent} />
            </>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <SeriesCounters counters={data.counters} numberLocale={me?.workspace.locale.numberLocale || "en-IN"} />
            <WarningsCard warnings={data.warnings} />
          </div>
        </div>
      ) : null}
    </>
  )
}
