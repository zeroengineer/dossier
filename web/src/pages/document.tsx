import { ArrowLeftIcon } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router"
import { useDocument } from "@/api/document"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DocumentActions } from "@/features/document/document-actions"
import { DocumentEntities } from "@/features/document/document-entities"
import { DocumentMetadata } from "@/features/document/document-metadata"
import { DocumentRelations } from "@/features/document/document-relations"
import { DocumentVersions } from "@/features/document/document-versions"
import { DocumentViewer } from "@/features/document/document-viewer"
import { parseVersionParam, pickVersion } from "@/features/document/renditions"
import { ApiError } from "@/lib/api"

/** Title for a failed document load: not found (404, or a malformed id), no access (403), or a generic failure. */
function errorTitle(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.code === "INVALID_INPUT") return "Document not found"
    if (error.status === 403) return "You do not have access to this document"
  }
  return "Could not load the document"
}

export default function DocumentPage() {
  const { id = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const query = useDocument(id)

  if (query.isPending) return <PageSkeleton />
  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : 0
    const final = status >= 400 && status < 500
    return (
      <div className="flex flex-col gap-4">
        <ErrorState error={query.error} title={errorTitle(query.error)} onRetry={final ? undefined : () => void query.refetch()} />
        <Button variant="outline" className="self-center" asChild>
          <Link to="/documents">
            <ArrowLeftIcon data-icon="inline-start" />
            All documents
          </Link>
        </Button>
      </div>
    )
  }

  const doc = query.data
  const version = pickVersion(doc, parseVersionParam(params.get("version")))
  const selectVersion = (versionNo: number) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      const current = doc.versions.find((v) => v.isCurrent)?.versionNo
      if (versionNo === current) next.delete("version")
      else next.set("version", String(versionNo))
      return next
    }, { replace: true })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={doc.title}
        description={`${doc.id} · ${doc.type}`}
        meta={
          <>
            {doc.docNumber ? <Badge variant="outline" className="tabular-nums">{doc.docNumber}</Badge> : null}
            <StatusBadge status={doc.status} />
            <SensitivityBadge level={doc.sensitivity} />
          </>
        }
        actions={<DocumentActions doc={doc} />}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <DocumentViewer docId={doc.id} title={doc.title} version={version} />
          <DocumentVersions versions={doc.versions} selected={version?.versionNo ?? null} onSelect={selectVersion} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <DocumentMetadata doc={doc} />
          <DocumentEntities entities={doc.entities} />
          <DocumentRelations relations={doc.relations} />
        </div>
      </div>
    </div>
  )
}
