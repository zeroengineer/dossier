import type { RowData } from "@tanstack/react-table"

declare module "@tanstack/react-table" {
  // Extra per-column options read by the data-table primitives (set via `columnDef.meta`).
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Human label for the column-visibility menu (defaults to the column id). */
    label?: string
    /** Classes for the column's header and cells, e.g. `hidden md:table-cell` or `text-right`. */
    className?: string
  }
}

export {}
