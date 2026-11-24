import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type InitialTableState,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { DataTablePagination } from "./data-table-pagination"
import "./column-meta"

export const DEFAULT_PAGE_SIZE = 20

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Stable row id (e.g. the document id); defaults to the row index. */
  getRowId?: (row: TData, index: number) => string
  /** Makes rows clickable (and keyboard-activatable with Enter). Clicks on buttons, links and inputs inside a row are ignored. */
  onRowClick?: (row: TData) => void
  /** Shows skeleton rows instead of data. */
  isLoading?: boolean
  /** Number of skeleton rows while loading (default: the page size, at most 10). */
  loadingRows?: number
  /** Rendered in a full-width cell when there are no rows (default: "No results."). */
  empty?: React.ReactNode
  /** Toolbar above the table; receives the table instance (see DataTableToolbar). */
  toolbar?: (table: TanstackTable<TData>) => React.ReactNode
  /** Show the pagination footer (default true). */
  showPagination?: boolean
  pageSizeOptions?: number[]
  initialState?: InitialTableState

  /** Controlled sorting. With `manualSorting` the rows are shown as given (server-side sort). */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  manualSorting?: boolean

  /** Controlled pagination. Passing `rowCount` switches to manual (server-side) pagination: `data` is one page. */
  pagination?: PaginationState
  onPaginationChange?: OnChangeFn<PaginationState>
  rowCount?: number

  /** Controlled client-side column filters (faceted filters / column search). */
  columnFilters?: ColumnFiltersState
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>

  /** Controlled column visibility (e.g. persisted by the feature). */
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>

  className?: string
}

/** Controlled when `value` is given, else internal state seeded from `initial`. */
function useMaybeControlled<T>(value: T | undefined, onChange: OnChangeFn<T> | undefined, initial: T): [T, OnChangeFn<T>] {
  const [inner, setInner] = React.useState<T>(initial)
  return [value ?? inner, onChange ?? setInner]
}

const INTERACTIVE = "a, button, input, select, textarea, label, [role=checkbox], [role=menuitem], [role=switch], [data-row-click=ignore]"

/** Generic TanStack Table v8 data table (shadcn "Data Table" pattern). */
export function DataTable<TData, TValue>({
  columns,
  data,
  getRowId,
  onRowClick,
  isLoading = false,
  loadingRows,
  empty,
  toolbar,
  showPagination = true,
  pageSizeOptions,
  initialState,
  sorting: sortingProp,
  onSortingChange,
  manualSorting = false,
  pagination: paginationProp,
  onPaginationChange,
  rowCount,
  columnFilters: columnFiltersProp,
  onColumnFiltersChange,
  columnVisibility: columnVisibilityProp,
  onColumnVisibilityChange,
  className,
}: DataTableProps<TData, TValue>) {
  const manualPagination = rowCount !== undefined
  const [sorting, setSorting] = useMaybeControlled(sortingProp, onSortingChange, initialState?.sorting ?? [])
  const [pagination, setPagination] = useMaybeControlled(paginationProp, onPaginationChange, {
    pageIndex: initialState?.pagination?.pageIndex ?? 0,
    pageSize: initialState?.pagination?.pageSize ?? DEFAULT_PAGE_SIZE,
  })
  const [columnFilters, setColumnFilters] = useMaybeControlled(columnFiltersProp, onColumnFiltersChange, initialState?.columnFilters ?? [])
  const [columnVisibility, setColumnVisibility] = useMaybeControlled(
    columnVisibilityProp,
    onColumnVisibilityChange,
    initialState?.columnVisibility ?? {},
  )

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, pagination, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting,
    manualPagination,
    manualFiltering: manualPagination,
    rowCount,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: manualPagination ? undefined : getFilteredRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const rows = table.getRowModel().rows
  const visibleColumns = table.getVisibleLeafColumns()
  const skeletonRows = loadingRows ?? Math.min(pagination.pageSize, 10)

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>, row: Row<TData>) {
    const target = event.target as HTMLElement
    const interactive = target.closest(INTERACTIVE)
    if (interactive && event.currentTarget.contains(interactive)) return
    onRowClick?.(row.original)
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, row: Row<TData>) {
    if (event.key !== "Enter" || event.target !== event.currentTarget) return
    event.preventDefault()
    onRowClick?.(row.original)
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {toolbar?.(table)}
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={cn("text-muted-foreground", header.column.columnDef.meta?.className)}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRows }, (_, i) => (
                <TableRow key={`skeleton-${i}`} data-testid="data-table-skeleton-row" className="hover:bg-transparent">
                  {visibleColumns.map((column) => (
                    <TableCell key={column.id} className={column.columnDef.meta?.className}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length > 0 ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(onRowClick && "cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none")}
                  onClick={onRowClick ? (event) => handleRowClick(event, row) : undefined}
                  onKeyDown={onRowClick ? (event) => handleRowKeyDown(event, row) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={Math.max(visibleColumns.length, 1)} className="h-24 text-center whitespace-normal text-muted-foreground">
                  {empty ?? "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {showPagination ? <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} /> : null}
    </div>
  )
}
