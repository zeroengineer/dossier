import type * as React from "react"
import type { Column } from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, EyeOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: React.ReactNode
  /** `end` for right-aligned (numeric) columns: the label's right edge lines up with the cells' text. */
  align?: "start" | "end"
  className?: string
}

/** Column header with a sort/hide menu; plain text when the column can neither sort nor hide. */
export function DataTableColumnHeader<TData, TValue>({ column, title, align = "start", className }: DataTableColumnHeaderProps<TData, TValue>) {
  const end = align === "end"
  if (!column.getCanSort() && !column.getCanHide()) {
    return <div className={cn(end && "text-right", className)}>{title}</div>
  }
  const sorted = column.getIsSorted()
  const SortIcon = sorted === "desc" ? ArrowDownIcon : sorted === "asc" ? ArrowUpIcon : ChevronsUpDownIcon

  return (
    <div className={cn("flex items-center gap-2", end && "justify-end", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("text-muted-foreground data-[state=open]:bg-accent", end ? "-mr-2.5" : "-ml-2.5")}
          >
            <span>{title}</span>
            {column.getCanSort() ? <SortIcon data-icon="inline-end" /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={end ? "end" : "start"}>
          {column.getCanSort() ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => column.toggleSorting(false)}>
                <ArrowUpIcon />
                Ascending
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => column.toggleSorting(true)}>
                <ArrowDownIcon />
                Descending
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
          {column.getCanSort() && column.getCanHide() ? <DropdownMenuSeparator /> : null}
          {column.getCanHide() ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
                <EyeOffIcon />
                Hide
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
