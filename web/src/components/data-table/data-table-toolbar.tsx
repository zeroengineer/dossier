import type * as React from "react"
import type { Table } from "@tanstack/react-table"
import { SearchIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import { DataTableViewOptions } from "./data-table-view-options"

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  /** Client-side search: filters this column id with the typed text. */
  searchColumn?: string
  /** Controlled search (server-side / URL params). Takes precedence over `searchColumn`. */
  search?: { value: string; onChange: (value: string) => void }
  searchPlaceholder?: string
  /** Filter slots (DataTableFacetedFilter, Select, date-range Popover, ...). */
  children?: React.ReactNode
  /** Right-aligned actions placed before the View menu (e.g. a "New" button). */
  actions?: React.ReactNode
  /** Extra filters are active outside the table state (URL params); shows Reset. */
  isFiltered?: boolean
  /** Called by Reset after the table's own column filters are cleared (clear URL params here). */
  onReset?: () => void
  /** Show the column-visibility menu (default true). */
  viewOptions?: boolean
  className?: string
}

/** Search input slot + filter slots + Reset, with the View (column visibility) menu on the right. */
export function DataTableToolbar<TData>({
  table,
  searchColumn,
  search,
  searchPlaceholder = "Search…",
  children,
  actions,
  isFiltered: isFilteredProp = false,
  onReset,
  viewOptions = true,
  className,
}: DataTableToolbarProps<TData>) {
  const column = searchColumn ? table.getColumn(searchColumn) : undefined
  const searchValue = search ? search.value : ((column?.getFilterValue() as string | undefined) ?? "")
  const isFiltered = isFilteredProp || table.getState().columnFilters.length > 0 || (search !== undefined && search.value !== "")
  const showSearch = search !== undefined || column !== undefined

  function setSearch(value: string) {
    if (search) search.onChange(value)
    else column?.setFilterValue(value === "" ? undefined : value)
  }

  function reset() {
    table.resetColumnFilters()
    if (search) search.onChange("")
    onReset?.()
  }

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {showSearch ? (
          <InputGroup className="w-full sm:w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
        ) : null}
        {children}
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset
            <XIcon data-icon="inline-end" />
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {viewOptions ? <DataTableViewOptions table={table} /> : null}
      </div>
    </div>
  )
}
