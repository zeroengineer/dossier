import { useSearchParams } from "react-router"
import { useMe } from "@/api/me"
import { useMeta } from "@/api/meta"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { NewDocumentForm } from "@/features/upload/new-document-form"
import { NewVersionForm } from "@/features/upload/new-version-form"

/** `/upload`: a new document with its metadata, or with `?documentId=` a new version of that document. */
export default function UploadPage() {
  const [params] = useSearchParams()
  const documentId = params.get("documentId")?.trim() ?? ""
  const meta = useMeta()
  const me = useMe()

  const header = (
    <PageHeader
      title={documentId ? "Upload new version" : "Upload"}
      description={documentId ? `Add a file as the next version of ${documentId}.` : "Add an existing file to the vault as a new document."}
    />
  )

  if (meta.isPending || me.isPending) return <PageSkeleton />
  if (meta.isError || me.isError) {
    const error = meta.error ?? me.error
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorState error={error} title="Could not load the upload form" onRetry={() => void Promise.all([meta.refetch(), me.refetch()])} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {header}
      {documentId ? (
        <NewVersionForm key={documentId} meta={meta.data} documentId={documentId} />
      ) : (
        <NewDocumentForm meta={meta.data} me={me.data} />
      )}
    </div>
  )
}
