import * as React from "react"
import { ArrowLeftIcon, PencilIcon } from "lucide-react"
import { Link, useParams } from "react-router"
import { useEntity } from "@/api/entities"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EntityDetails } from "@/features/entities/entity-details"
import { EntityDocuments } from "@/features/entities/entity-documents"
import { EntityFormDialog } from "@/features/entities/entity-form-dialog"
import { kindLabel } from "@/features/entities/labels"
import { EntityRelations } from "@/features/entities/entity-relations"
import { ApiError } from "@/lib/api"

export default function EntityPage() {
  const { id = "" } = useParams()
  const { data: entity, isPending, isError, error, refetch } = useEntity(id)
  const [editing, setEditing] = React.useState(false)

  if (isError) {
    const missing = error instanceof ApiError && error.code === "ENTITY_NOT_FOUND"
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={missing ? "Entity not found" : "Entity"} />
        <ErrorState
          error={error}
          title={missing ? `No entity ${id}` : "Could not load the entity"}
          onRetry={missing ? undefined : () => void refetch()}
        />
        <Button asChild variant="outline" className="self-start">
          <Link to="/entities">
            <ArrowLeftIcon data-icon="inline-start" />
            All entities
          </Link>
        </Button>
      </div>
    )
  }

  if (isPending) return <PageSkeleton />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={entity.name}
        meta={
          <Badge variant="secondary" asChild>
            <Link to={`/entities?kind=${encodeURIComponent(entity.kind)}`}>{kindLabel(entity.kind)}</Link>
          </Badge>
        }
        description={entity.aliases.length ? `Also known as ${entity.aliases.join(", ")}` : undefined}
        actions={
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <EntityDetails entity={entity} />
        <div className="flex min-w-0 flex-col gap-6">
          <EntityRelations entity={entity} />
          <EntityDocuments entity={entity} />
        </div>
      </div>
      <EntityFormDialog open={editing} onOpenChange={setEditing} entity={entity} />
    </div>
  )
}
