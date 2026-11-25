import { useMeta } from "@/api/meta"
import { useSeries, useSeriesUsage } from "@/api/settings"
import { ErrorState } from "@/components/error-state"
import { PageSkeleton } from "@/components/page-skeleton"
import { NumberingEditor } from "@/features/settings/numbering/numbering-editor"
import { SettingsPage } from "@/features/settings/settings-page"

export default function NumberingSettingsPage() {
  const series = useSeries()
  const usage = useSeriesUsage()
  const meta = useMeta()
  const failed = series.isError ? series : meta.isError ? meta : null

  return (
    <SettingsPage title="Numbering" description="Numbering series, their patterns and where each is used.">
      {failed ? (
        <ErrorState error={failed.error} title="Could not load the numbering series" onRetry={() => void failed.refetch()} />
      ) : series.data && meta.data ? (
        <NumberingEditor series={series.data} usage={usage.isError ? "unavailable" : (usage.data ?? null)} scopes={meta.data.seriesScopes} />
      ) : (
        <PageSkeleton />
      )}
    </SettingsPage>
  )
}
