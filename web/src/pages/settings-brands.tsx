import { useBrands } from "@/api/brands"
import { ErrorState } from "@/components/error-state"
import { BrandsTable } from "@/features/settings/brands/brands-table"
import { NewBrandDialog } from "@/features/settings/brands/new-brand-dialog"
import { SettingsPage } from "@/features/settings/settings-page"

export default function BrandsSettingsPage() {
  const { data, isPending, isError, error, refetch } = useBrands()
  return (
    <SettingsPage
      title="Brands"
      description="Identity, letterhead, palette, fonts and assets of each brand."
      actions={<NewBrandDialog brands={data?.brands ?? []} />}
    >
      {isError ? (
        <ErrorState error={error} title="Could not load brands" onRetry={() => void refetch()} />
      ) : (
        <BrandsTable brands={data?.brands ?? []} isLoading={isPending} />
      )}
    </SettingsPage>
  )
}
