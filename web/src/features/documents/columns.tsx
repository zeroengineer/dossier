import type { ColumnDef } from "@tanstack/react-table"
import { Link } from "react-router"
import { TriangleAlertIcon } from "lucide-react"
import type { DocumentSummary } from "@/api/types"
import { DateText } from "@/components/date-text"
import { Money } from "@/components/money"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const none = <span className="text-muted-foreground">—</span>

/** Number, title, type, party, status, date, amount. Sorting is the server's (newest document date first). */
export const documentColumns: ColumnDef<DocumentSummary>[] = [
  {
    id: "number",
    accessorKey: "docNumber",
    header: "Number",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const { docNumber, numberConflict } = row.original
      return (
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums">{docNumber ?? row.original.id}</span>
          {numberConflict ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" tabIndex={0} data-row-click="ignore">
                  <TriangleAlertIcon data-icon="inline-start" />
                  Conflict
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Another document of this series has the same number</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      )
    },
    meta: { label: "Number" },
  },
  {
    id: "title",
    accessorKey: "title",
    header: "Title",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <Link to={`/documents/${encodeURIComponent(row.original.id)}`} title={row.original.title} className="block max-w-48 truncate font-medium hover:underline sm:max-w-80">
        {row.original.title}
      </Link>
    ),
    meta: { label: "Title" },
  },
  {
    id: "type",
    accessorKey: "type",
    header: "Type",
    enableSorting: false,
    meta: { label: "Type" },
  },
  {
    id: "party",
    accessorFn: (d) => d.party?.name ?? null,
    header: "Party",
    enableSorting: false,
    cell: ({ row }) => (row.original.party ? <span className="block max-w-60 truncate">{row.original.party.name}</span> : none),
    meta: { label: "Party", className: "hidden md:table-cell" },
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    enableSorting: false,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    meta: { label: "Status" },
  },
  {
    id: "date",
    accessorKey: "docDate",
    header: "Date",
    enableSorting: false,
    cell: ({ row }) => <DateText value={row.original.docDate} />,
    meta: { label: "Date", className: "hidden md:table-cell" },
  },
  {
    id: "amount",
    accessorKey: "amountMinor",
    header: "Amount",
    enableSorting: false,
    cell: ({ row }) => {
      const { amountMinor, currency } = row.original
      return amountMinor === null ? none : <Money amountMinor={amountMinor} currency={currency ?? undefined} />
    },
    meta: { label: "Amount", className: "hidden text-right md:table-cell" },
  },
]
