import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { SparklesIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"
import type { TemplateSummary } from "@/api/types"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTableToolbar,
  facetFilterFn,
  type FacetOption,
} from "@/components/data-table"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { categoryLabel, numberingLabel, ORIGIN_LABELS, templateOrigin, type TemplateOrigin } from "./labels"

export const generatePath = (id: string) => `/generate/${encodeURIComponent(id)}`

const columns: ColumnDef<TemplateSummary>[] = [
  {
    accessorKey: "title",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
    enableHiding: false,
    cell: ({ row }) => (
      <div className="flex max-w-80 min-w-0 flex-col gap-0.5">
        <Link to={generatePath(row.original.id)} className="truncate font-medium hover:underline">
          {row.original.title}
        </Link>
        {row.original.description ? (
          <span className="truncate text-xs text-muted-foreground" title={row.original.description}>
            {row.original.description}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "category",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
    filterFn: facetFilterFn,
    meta: { label: "Category" },
    cell: ({ row }) => <Badge variant="secondary">{categoryLabel(row.original.category)}</Badge>,
  },
  {
    accessorKey: "type",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    meta: { label: "Type", className: "hidden md:table-cell" },
  },
  {
    accessorKey: "version",
    header: "Version",
    meta: { label: "Version", className: "hidden lg:table-cell" },
    cell: ({ row }) => <span className="tabular-nums">v{row.original.version}</span>,
  },
  {
    id: "numbering",
    accessorFn: (t) => numberingLabel(t.numbering),
    header: "Numbering",
    meta: { label: "Numbering", className: "hidden lg:table-cell" },
    cell: ({ row, getValue }) => (
      <span className={row.original.numbering ? undefined : "text-muted-foreground"}>{getValue<string>()}</span>
    ),
  },
  {
    id: "renditions",
    accessorFn: (t) => t.renditions.join(", "),
    header: "Renditions",
    enableSorting: false,
    meta: { label: "Renditions", className: "hidden xl:table-cell" },
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.renditions.map((r) => (
          <Badge key={r} variant="outline" className="uppercase">
            {r}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    accessorKey: "sensitivity",
    header: "Sensitivity",
    meta: { label: "Sensitivity", className: "hidden md:table-cell" },
    cell: ({ row }) => <SensitivityBadge level={row.original.sensitivity} />,
  },
  {
    id: "source",
    accessorFn: (t) => templateOrigin(t),
    header: "Source",
    filterFn: facetFilterFn,
    meta: { label: "Source" },
    cell: ({ getValue }) => {
      const origin = getValue<TemplateOrigin>()
      return <Badge variant={origin === "builtin" ? "secondary" : "outline"}>{ORIGIN_LABELS[origin]}</Badge>
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    enableHiding: false,
    enableSorting: false,
    meta: { className: "text-right" },
    cell: ({ row }) => (
      <Button asChild variant="outline" size="sm">
        <Link to={generatePath(row.original.id)} aria-label={`Generate ${row.original.title}`}>
          <SparklesIcon data-icon="inline-start" />
          Generate
        </Link>
      </Button>
    ),
  },
]

interface TemplatesTableProps {
  templates: TemplateSummary[]
  isLoading?: boolean
}

/** All loadable templates, grouped by category (default sort), filterable by category and source. */
export function TemplatesTable({ templates, isLoading = false }: TemplatesTableProps) {
  const navigate = useNavigate()

  const categoryOptions = React.useMemo<FacetOption[]>(
    () => [...new Set(templates.map((t) => t.category))].sort().map((c) => ({ value: c, label: categoryLabel(c) })),
    [templates],
  )
  const sourceOptions = React.useMemo<FacetOption[]>(() => {
    const present = new Set(templates.map(templateOrigin))
    return (Object.keys(ORIGIN_LABELS) as TemplateOrigin[]).filter((o) => present.has(o)).map((o) => ({ value: o, label: ORIGIN_LABELS[o] }))
  }, [templates])

  return (
    <DataTable
      mode="client"
      columns={columns}
      data={templates}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      onRowClick={(t) => navigate(generatePath(t.id))}
      initialState={{ sorting: [{ id: "category", desc: false }] }}
      empty="No templates match."
      toolbar={(table) => (
        <DataTableToolbar table={table} searchColumn="title" searchPlaceholder="Search templates…">
          {table.getColumn("category") ? (
            <DataTableFacetedFilter title="Category" column={table.getColumn("category")} options={categoryOptions} />
          ) : null}
          {table.getColumn("source") ? (
            <DataTableFacetedFilter title="Source" column={table.getColumn("source")} options={sourceOptions} />
          ) : null}
        </DataTableToolbar>
      )}
    />
  )
}
