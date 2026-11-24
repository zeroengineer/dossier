import type * as React from "react"
import type { Column } from "@tanstack/react-table"
import { CheckIcon, PlusCircleIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export interface FacetOption {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}

interface DataTableFacetedFilterProps<TData, TValue> {
  title: string
  options: FacetOption[]
  /** Client-side mode: filters this column (its filterFn must accept a string[]; see `facetFilterFn`). */
  column?: Column<TData, TValue>
  /** Controlled mode (server-side / URL params): the selected values. Ignored when `column` is given. */
  selected?: string[]
  onSelectedChange?: (values: string[]) => void
  /** Allow only one value (radio-like); the selection still is an array of at most one value. */
  single?: boolean
}

/** Column filterFn for faceted filters: keeps rows whose value is one of the selected values. */
export function facetFilterFn(row: { getValue: (id: string) => unknown }, columnId: string, filterValue: unknown): boolean {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true
  return filterValue.includes(String(row.getValue(columnId)))
}

/** Multi-select filter button (Popover + Command) with selected-value badges and per-option counts in client mode. */
export function DataTableFacetedFilter<TData, TValue>({
  title,
  options,
  column,
  selected: selectedProp,
  onSelectedChange,
  single = false,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues()
  const filterValue = column?.getFilterValue()
  const selected = new Set<string>(column ? (Array.isArray(filterValue) ? (filterValue as string[]) : []) : (selectedProp ?? []))

  function update(values: string[]) {
    if (column) column.setFilterValue(values.length > 0 ? values : undefined)
    else onSelectedChange?.(values)
  }

  function toggle(value: string) {
    if (single) {
      update(selected.has(value) ? [] : [value])
      return
    }
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    update(options.map((o) => o.value).filter((v) => next.has(v)))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <PlusCircleIcon data-icon="inline-start" />
          {title}
          {selected.size > 0 ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge variant="secondary" className="lg:hidden">
                {selected.size}
              </Badge>
              <div className="hidden gap-1 lg:flex">
                {selected.size > 2 ? (
                  <Badge variant="secondary">{selected.size} selected</Badge>
                ) : (
                  options
                    .filter((option) => selected.has(option.value))
                    .map((option) => (
                      <Badge variant="secondary" key={option.value}>
                        {option.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.has(option.value)
                const count = facets?.get(option.value)
                return (
                  <CommandItem key={option.value} value={option.label} onSelect={() => toggle(option.value)} data-checked={isSelected}>
                    <div
                      aria-hidden
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border border-input",
                        isSelected ? "border-primary bg-primary text-primary-foreground" : "[&_svg]:invisible",
                      )}
                    >
                      <CheckIcon className="size-3.5 text-primary-foreground" />
                    </div>
                    {option.icon ? <option.icon className="text-muted-foreground" /> : null}
                    <span>{option.label}</span>
                    {count !== undefined ? <span className="ml-auto font-mono text-xs text-muted-foreground">{count}</span> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => update([])} className="justify-center text-center">
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
