import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"
import type { EntityDetail, EntityRelationView } from "@/api/types"
import { DataTable } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AddRelationDialog } from "./add-relation-dialog"
import { entityPath, kindLabel, roleLabel } from "./labels"

const PAGE = 20

function columnsFor(name: string): ColumnDef<EntityRelationView>[] {
  return [
    {
      id: "relation",
      accessorFn: (r) => `${r.role} ${r.entity.name}`,
      header: "Relation",
      cell: ({ row }) => {
        const r = row.original
        const other = (
          <Link to={entityPath(r.entity.id)} className="font-medium hover:underline">
            {r.entity.name}
          </Link>
        )
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {r.direction === "out" ? (
              <>
                <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">{name}</span>{" "}
                <em>{roleLabel(r.role)}</em>{" "}
                {other}
              </>
            ) : (
              <>
                <ArrowLeftIcon className="size-3.5 text-muted-foreground" aria-hidden />
                {other}{" "}
                <em>{roleLabel(r.role)}</em>{" "}
                <span className="text-muted-foreground">{name}</span>
              </>
            )}
          </span>
        )
      },
    },
    {
      id: "kind",
      accessorFn: (r) => r.entity.kind,
      header: "Kind",
      cell: ({ row }) => <Badge variant="secondary">{kindLabel(row.original.entity.kind)}</Badge>,
    },
    {
      id: "attrs",
      accessorFn: (r) => JSON.stringify(r.attrs),
      header: "Details",
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => {
        const entries = Object.entries(row.original.attrs)
        if (!entries.length) return <span className="text-muted-foreground">—</span>
        return (
          <span className="text-xs text-muted-foreground">
            {entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")}
          </span>
        )
      },
    },
  ]
}

/** Relations of the entity in both directions, with the Add relation dialog. Rows open the related entity. */
export function EntityRelations({ entity }: { entity: EntityDetail }) {
  const navigate = useNavigate()
  const [adding, setAdding] = React.useState(false)
  const columns = React.useMemo(() => columnsFor(entity.name), [entity.name])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Relations</CardTitle>
        <CardDescription>People, companies and other entities this one is connected to.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" />
            Add relation
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          mode="client"
          columns={columns}
          data={entity.relations}
          getRowId={(r) => String(r.id)}
          onRowClick={(r) => navigate(entityPath(r.entity.id))}
          empty="No relations yet."
          showPagination={entity.relations.length > PAGE}
          initialState={{ pagination: { pageIndex: 0, pageSize: PAGE } }}
        />
      </CardContent>
      <AddRelationDialog entity={entity} open={adding} onOpenChange={setAdding} />
    </Card>
  )
}
