import { Fragment } from "react"
import { Link, useNavigate } from "react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowLeftIcon, FolderIcon, FolderOpenIcon, FolderTreeIcon } from "lucide-react"
import type { TreeDocument, TreeNode } from "@/api/types"
import { useTreeNode } from "@/api/vault"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { DateText } from "@/components/date-text"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { StatusBadge } from "@/components/status-badge"
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { folderCrumbs, vaultHref } from "./paths"

const columns: ColumnDef<TreeDocument>[] = [
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{row.original.displayName}</span>
        <span className="text-xs text-muted-foreground">{row.original.id}</span>
      </div>
    ),
    enableHiding: false,
    meta: { label: "Name" },
  },
  {
    accessorKey: "type",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    meta: { label: "Type", className: "hidden md:table-cell" },
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    meta: { label: "Status" },
  },
  {
    accessorKey: "sensitivity",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Sensitivity" />,
    cell: ({ row }) => <SensitivityBadge level={row.original.sensitivity} />,
    meta: { label: "Sensitivity", className: "hidden lg:table-cell" },
  },
  {
    accessorKey: "docDate",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => <DateText value={row.original.docDate} />,
    meta: { label: "Date", className: "hidden sm:table-cell" },
  },
]

/** The selected folder: breadcrumb, title and its documents (rows open `/documents/:id`). */
export function FolderDocuments({ nodeId }: { nodeId: string }) {
  const node = useTreeNode(nodeId)
  // The root is already loaded by the tree; it gives every ancestor's name for the breadcrumb.
  const root = useTreeNode("")
  const navigate = useNavigate()

  if (node.isError) {
    if (node.error instanceof ApiError && node.error.status === 404) {
      return (
        <div className="flex flex-col items-center gap-4">
          <ErrorState error={node.error} title="Folder not found" className="w-full" />
          <Button variant="outline" asChild>
            <Link to="/vault">
              <ArrowLeftIcon data-icon="inline-start" />
              Back to Vault
            </Link>
          </Button>
        </div>
      )
    }
    return <ErrorState error={node.error} title="Could not load this folder" onRetry={() => void node.refetch()} />
  }

  if (!nodeId) {
    return (
      <EmptyState
        icon={FolderTreeIcon}
        title="Choose a folder"
        description="The vault is a folder tree computed from document metadata. Pick a folder on the left to see its documents."
        className="min-h-72"
      />
    )
  }

  if (node.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-7 w-48" />
        <DataTable columns={columns} data={[]} isLoading loadingRows={5} showPagination={false} />
      </div>
    )
  }

  const folder = node.data
  const subfolders = folder.children.length
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <FolderBreadcrumb node={folder} root={root.data} />
        <div className="flex flex-col gap-1">
          <h2 className="truncate font-heading text-xl font-semibold tracking-tight">{folder.name}</h2>
          <p className="text-sm text-muted-foreground">
            {plural(folder.documents.length, "document")}
            {subfolders ? ` · ${plural(subfolders, "subfolder")}` : null}
          </p>
        </div>
      </div>
      {folder.documents.length ? (
        <DataTable
          columns={columns}
          data={folder.documents}
          getRowId={(d) => d.id}
          onRowClick={(d) => void navigate(`/documents/${encodeURIComponent(d.id)}`)}
        />
      ) : (
        <EmptyFolder folder={folder} />
      )}
    </div>
  )
}

function EmptyFolder({ folder }: { folder: TreeNode }) {
  const subfolders = folder.children
  return (
    <EmptyState
      icon={FolderOpenIcon}
      title="This folder is empty"
      description={
        subfolders.length
          ? "No documents sit directly in this folder. Open one of its subfolders."
          : "No documents are filed here yet. Documents land in folders by their type, party and date."
      }
      action={
        subfolders.length ? (
          <div className="flex flex-wrap justify-center gap-2">
            {subfolders.map((child) => (
              <Button key={child.id} variant="outline" size="sm" asChild>
                <Link to={vaultHref(child.id)}>
                  <FolderIcon data-icon="inline-start" />
                  {child.name}
                </Link>
              </Button>
            ))}
          </div>
        ) : null
      }
      className="min-h-72"
    />
  )
}

function FolderBreadcrumb({ node, root }: { node: TreeNode; root: TreeNode | undefined }) {
  const crumbs = folderCrumbs(node, root)
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/vault">Vault</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb.id}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={vaultHref(crumb.id)}>{crumb.name}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
