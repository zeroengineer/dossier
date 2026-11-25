import type * as React from "react"
import type { ColumnDef, FilterFn } from "@tanstack/react-table"
import { Link, useNavigate } from "react-router"
import type { EntitySummary } from "@/api/types"
import { DataTable, DataTableColumnHeader, DataTableToolbar } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { entityPath, kindLabel } from "./labels"

/** Search matches the name or any alias, case-insensitively. */
const nameOrAlias: FilterFn<EntitySummary> = (row, _columnId, value) => {
  const q = String(value ?? "").trim().toLowerCase()
  if (!q) return true
  const e = row.original
  return e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q))
}

const columns: ColumnDef<EntitySummary>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    filterFn: nameOrAlias,
    enableHiding: false,
    cell: ({ row }) => (
      <Link to={entityPath(row.original.id)} title={row.original.name} className="block max-w-48 truncate font-medium hover:underline sm:max-w-80">
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "aliases",
    accessorFn: (e) => e.aliases.join(", "),
    header: "Aliases",
    enableSorting: false,
    meta: { label: "Aliases", className: "hidden md:table-cell" },
    cell: ({ row }) =>
      row.original.aliases.length ? (
        <span className="block max-w-72 truncate text-muted-foreground" title={row.original.aliases.join(", ")}>
          {row.original.aliases.join(", ")}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "kind",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Kind" />,
    meta: { label: "Kind" },
    cell: ({ row }) => <Badge variant="secondary">{kindLabel(row.original.kind)}</Badge>,
  },
  {
    accessorKey: "brand",
    header: "Brand",
    enableSorting: false,
    meta: { label: "Brand", className: "hidden lg:table-cell" },
    cell: ({ row }) => row.original.brand ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "documentCount",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Documents" align="end" />,
    meta: { label: "Documents", className: "text-right" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.documentCount}</span>,
  },
]

interface EntitiesTableProps {
  entities: EntitySummary[]
  isLoading?: boolean
  /** Hide the kind column at first (a single-kind tab). Read on mount: key the table by tab. */
  hideKind?: boolean
  /** "New entity" button for the toolbar. */
  actions?: React.ReactNode
}

/** Client-side entity list: search by name or alias, sort by name, kind or document count. */
export function EntitiesTable({ entities, isLoading = false, hideKind = false, actions }: EntitiesTableProps) {
  const navigate = useNavigate()
  return (
    <DataTable
      mode="client"
      columns={columns}
      data={entities}
      getRowId={(e) => String(e.id)}
      isLoading={isLoading}
      onRowClick={(e) => navigate(entityPath(e.id))}
      initialState={{ sorting: [{ id: "name", desc: false }], columnVisibility: hideKind ? { kind: false } : {} }}
      empty="No entities match."
      toolbar={(table) => (
        <DataTableToolbar table={table} searchColumn="name" searchPlaceholder="Search names and aliases…" actions={actions} />
      )}
    />
  )
}
