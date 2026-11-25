import type { ColumnDef } from "@tanstack/react-table"
import { Link, useNavigate } from "react-router"
import { useEntityDocuments } from "@/api/entities"
import type { DocumentSummary, EntityDetail } from "@/api/types"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { DateText } from "@/components/date-text"
import { ErrorState } from "@/components/error-state"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const documentPath = (id: string) => `/documents/${encodeURIComponent(id)}`

const columns: ColumnDef<DocumentSummary>[] = [
  {
    accessorKey: "title",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
    cell: ({ row }) => (
      <div className="flex max-w-80 min-w-0 flex-col gap-0.5">
        <Link to={documentPath(row.original.id)} className="truncate font-medium hover:underline">
          {row.original.title}
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">{row.original.id}</span>
      </div>
    ),
  },
  {
    accessorKey: "type",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    meta: { className: "hidden md:table-cell" },
  },
  {
    accessorKey: "docNumber",
    header: "Number",
    enableSorting: false,
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => row.original.docNumber ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "docDate",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => <DateText value={row.original.docDate} />,
  },
]

/** Documents that reference the entity in any role (party, issuer, business line, engagement, linked entity). */
export function EntityDocuments({ entity }: { entity: EntityDetail }) {
  const navigate = useNavigate()
  const { data, isPending, isError, error, refetch } = useEntityDocuments(entity.id)
  const documents = data?.documents ?? []
  // `total` counts the documents the user may see; the list shows the first page of them.
  const pastLimit = data ? Math.max(0, data.total - documents.length) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>Documents that name this entity as party, issuer, business line, engagement or in any other role.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isError ? (
          <ErrorState error={error} title="Could not load documents" onRetry={() => void refetch()} />
        ) : (
          <DataTable
            mode="client"
            columns={columns}
            data={documents}
            getRowId={(d) => d.id}
            isLoading={isPending}
            loadingRows={3}
            onRowClick={(d) => navigate(documentPath(d.id))}
            empty="No documents you can see refer to this entity."
            showPagination={documents.length > 20}
          />
        )}
        {pastLimit > 0 ? (
          <p className="text-sm text-muted-foreground">
            Showing the latest {documents.length} of {data?.total} documents. {pastLimit} more {pastLimit === 1 ? "is" : "are"} not
            listed here.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
