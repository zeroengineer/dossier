import { DownloadIcon } from "lucide-react"
import { Link, useParams } from "react-router"
import { brandUrls, useBrand, useSeriesIds } from "@/api/brands"
import { useMeta } from "@/api/meta"
import { ErrorState } from "@/components/error-state"
import { PageSkeleton } from "@/components/page-skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BrandEditor } from "@/features/settings/brands/brand-editor"
import { SettingsPage } from "@/features/settings/settings-page"

export default function BrandSettingsPage() {
  const { id = "" } = useParams()
  const brand = useBrand(id)
  const parentId = typeof brand.data?.file.inheritsFrom === "string" ? brand.data.file.inheritsFrom : ""
  const parent = useBrand(parentId)
  const meta = useMeta()
  const series = useSeriesIds()

  const failed = brand.isError ? brand : parent.isError ? parent : meta.isError ? meta : null
  const ready = brand.data && meta.data && (!parentId || parent.data)

  return (
    <SettingsPage
      title={id}
      description={brand.data ? brand.data.resolved.legalName : "Edit this brand as one form and preview its letterhead."}
      meta={parentId ? (
        <Badge variant="secondary">
          Inherits from{" "}
          <Link to={`/settings/brands/${encodeURIComponent(parentId)}`} className="underline-offset-4 hover:underline">{parentId}</Link>
        </Badge>
      ) : null}
      actions={(
        <Button asChild variant="outline" size="sm">
          <a href={brandUrls.file(id)} download={`${id}.json`}>
            <DownloadIcon data-icon="inline-start" />
            Download brand.json
          </a>
        </Button>
      )}
    >
      {failed ? (
        <ErrorState error={failed.error} title={`Could not load brand ${id}`} onRetry={() => void failed.refetch()} />
      ) : ready && brand.data && meta.data ? (
        <BrandEditor
          key={id}
          brand={brand.data}
          parent={parent.data?.resolved ?? null}
          fontWeights={meta.data.fontWeights}
          builtinFonts={meta.data.builtinFonts}
          seriesIds={series.data ?? []}
          assetMaxBytes={meta.data.limits.assetMaxBytes}
        />
      ) : (
        <PageSkeleton />
      )}
    </SettingsPage>
  )
}
