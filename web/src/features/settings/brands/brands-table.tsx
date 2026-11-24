import type { ColumnDef } from "@tanstack/react-table"
import { DownloadIcon, FileTextIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { brandUrls } from "@/api/brands"
import type { BrandListItem } from "@/api/types"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"

export const brandPath = (id: string) => `/settings/brands/${encodeURIComponent(id)}`

const columns: ColumnDef<BrandListItem>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Id" />,
    enableHiding: false,
    cell: ({ row }) => (
      <Link to={brandPath(row.original.id)} className="font-medium hover:underline">
        {row.original.id}
      </Link>
    ),
  },
  {
    accessorKey: "legalName",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Legal name" />,
    meta: { label: "Legal name" },
  },
  {
    id: "inheritsFrom",
    accessorFn: (b) => b.inheritsFrom ?? "",
    header: "Inherits from",
    meta: { label: "Inherits from", className: "hidden md:table-cell" },
    cell: ({ row }) =>
      row.original.inheritsFrom ? (
        <Link to={brandPath(row.original.inheritsFrom)} className="hover:underline">{row.original.inheritsFrom}</Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "actions",
    enableHiding: false,
    header: () => <span className="sr-only">Files</span>,
    cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <Button asChild variant="ghost" size="icon-sm">
          <a href={brandUrls.preview(row.original.id)} target="_blank" rel="noopener" aria-label={`Letterhead preview of ${row.original.id}`}>
            <FileTextIcon />
          </a>
        </Button>
        <Button asChild variant="ghost" size="icon-sm">
          <a href={brandUrls.file(row.original.id)} download={`${row.original.id}.json`} aria-label={`Download brand.json of ${row.original.id}`}>
            <DownloadIcon />
          </a>
        </Button>
      </div>
    ),
  },
]

export function BrandsTable({ brands, isLoading }: { brands: BrandListItem[]; isLoading?: boolean }) {
  const navigate = useNavigate()
  return (
    <DataTable
      columns={columns}
      data={brands}
      getRowId={(b) => b.id}
      isLoading={isLoading}
      onRowClick={(b) => void navigate(brandPath(b.id))}
      empty="No brands yet."
      showPagination={brands.length > 20}
    />
  )
}
