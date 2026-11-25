import * as React from "react"
import { Building2Icon, PlusIcon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router"
import { ENTITY_LIST_LIMIT, useEntities } from "@/api/entities"
import { useMeta } from "@/api/meta"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollableTabsList } from "@/components/scrollable-tabs-list"
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { EntitiesTable } from "@/features/entities/entities-table"
import { EntityFormDialog } from "@/features/entities/entity-form-dialog"
import { entityPath, kindLabel } from "@/features/entities/labels"

const ALL = "all"

export default function EntitiesPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: meta } = useMeta()
  const requested = params.get("kind") ?? ""
  // An unknown ?kind= (an old link, a typo) falls back to All once the kinds are known.
  const kind = requested && meta && !meta.entityKinds.includes(requested) ? "" : requested
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useEntities({ kind: kind || undefined, limit: ENTITY_LIST_LIMIT })
  const [creating, setCreating] = React.useState(false)

  const kinds = meta?.entityKinds ?? []
  const tab = kind || ALL
  const entities = data?.entities ?? []
  const loading = isPending || isPlaceholderData
  const label = kind ? kindLabel(kind) : null

  function selectTab(value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === ALL) next.delete("kind")
        else next.set("kind", value)
        return next
      },
      { replace: true },
    )
  }

  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon data-icon="inline-start" />
      New entity
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Entities"
        description="Companies, people, clients, vendors and the other names documents refer to."
        actions={newButton}
      />

      <Tabs value={tab} onValueChange={selectTab}>
        <ScrollableTabsList aria-label="Entity kind">
          <TabsTrigger value={ALL}>All</TabsTrigger>
          {kinds.map((k) => (
            <TabsTrigger key={k} value={k}>
              {kindLabel(k)}
            </TabsTrigger>
          ))}
          {kind && !kinds.includes(kind) ? <TabsTrigger value={kind}>{kind}</TabsTrigger> : null}
        </ScrollableTabsList>

        <TabsContent value={tab} className="flex flex-col gap-3">
          {isError ? (
            <ErrorState error={error} title="Could not load entities" onRetry={() => void refetch()} />
          ) : data && !loading && entities.length === 0 ? (
            <EmptyState
              icon={Building2Icon}
              title={label ? `No ${label.toLowerCase()} entities` : "No entities yet"}
              description="Entities are created when documents are filed or generated, from the workspace seeds, or here."
              action={newButton}
            />
          ) : (
            <>
              <EntitiesTable key={tab} entities={entities} isLoading={loading} hideKind={kind !== ""} />
              {entities.length >= ENTITY_LIST_LIMIT ? (
                <p className="text-sm text-muted-foreground">
                  Showing the first {ENTITY_LIST_LIMIT} entities. Pick a kind to narrow the list.
                </p>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>

      <EntityFormDialog
        open={creating}
        onOpenChange={setCreating}
        defaultKind={kind && kinds.includes(kind) ? kind : ""}
        onSaved={(e) => navigate(entityPath(e.id))}
      />
    </div>
  )
}
