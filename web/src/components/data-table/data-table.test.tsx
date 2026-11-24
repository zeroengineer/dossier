import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ColumnDef } from "@tanstack/react-table"
import { describe, expect, it, vi } from "vitest"
import { DataTable } from "./data-table"
import { DataTableColumnHeader } from "./data-table-column-header"
import { DataTableFacetedFilter, facetFilterFn } from "./data-table-faceted-filter"
import { DataTableToolbar } from "./data-table-toolbar"

interface Doc {
  id: string
  title: string
  party: string
  status: string
}

const docs: Doc[] = [
  { id: "DOC-000001", title: "Venue quotation", party: "Acme Events", status: "Draft" },
  { id: "DOC-000002", title: "Stage invoice", party: "Alex Example", status: "Sent" },
  { id: "DOC-000003", title: "Catering invoice", party: "Acme Events", status: "Paid" },
]

const columns: ColumnDef<Doc>[] = [
  { accessorKey: "id", header: "ID", enableHiding: false },
  { accessorKey: "title", header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />, meta: { label: "Title" } },
  { accessorKey: "party", header: "Party", meta: { label: "Party", className: "hidden md:table-cell" } },
  { accessorKey: "status", header: "Status", filterFn: facetFilterFn, meta: { label: "Status" } },
]

const bodyRows = () => screen.getAllByRole("row").slice(1)

describe("DataTable", () => {
  it("renders a row per item with its cells", () => {
    render(<DataTable columns={columns} data={docs} getRowId={(d) => d.id} />)
    expect(bodyRows()).toHaveLength(3)
    expect(screen.getByRole("cell", { name: "Venue quotation" })).toBeInTheDocument()
    expect(screen.getByText("3 rows")).toBeInTheDocument()
  })

  it("calls onRowClick with the row's item on click and on Enter", async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} data={docs} onRowClick={onRowClick} />)
    await user.click(screen.getByRole("cell", { name: "Stage invoice" }))
    expect(onRowClick).toHaveBeenLastCalledWith(docs[1])
    const row = bodyRows()[2]!
    row.focus()
    await user.keyboard("{Enter}")
    expect(onRowClick).toHaveBeenLastCalledWith(docs[2])
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })

  it("hides and shows a column from the View menu", async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={docs} toolbar={(table) => <DataTableToolbar table={table} />} />)
    expect(screen.getByRole("columnheader", { name: "Party" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "View" }))
    const party = await screen.findByRole("menuitemcheckbox", { name: "Party" })
    expect(party).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByRole("menuitemcheckbox", { name: "ID" })).not.toBeInTheDocument()
    await user.click(party)
    // The menu stays open (and modal) so several columns can be toggled; close it before reading the table.
    expect(screen.getByRole("menuitemcheckbox", { name: "Party" })).toHaveAttribute("aria-checked", "false")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("columnheader", { name: "Party" })).not.toBeInTheDocument()
    expect(screen.queryByRole("cell", { name: "Alex Example" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "View" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Party" }))
    await user.keyboard("{Escape}")
    expect(screen.getByRole("columnheader", { name: "Party" })).toBeInTheDocument()
  })

  it("shows the empty state when there are no rows", () => {
    render(<DataTable columns={columns} data={[]} empty="No documents yet." />)
    expect(screen.getByRole("cell", { name: "No documents yet." })).toBeInTheDocument()
    expect(screen.getByText("0 rows")).toBeInTheDocument()
  })

  it("shows skeleton rows while loading", () => {
    render(<DataTable columns={columns} data={[]} isLoading loadingRows={4} />)
    expect(screen.getAllByTestId("data-table-skeleton-row")).toHaveLength(4)
    expect(screen.queryByText("No results.")).not.toBeInTheDocument()
  })

  it("sorts from the column header menu", async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={docs} />)
    await user.click(screen.getByRole("button", { name: "Title" }))
    await user.click(await screen.findByRole("menuitem", { name: "Descending" }))
    expect(within(bodyRows()[0]!).getByRole("cell", { name: "Venue quotation" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Title" })).toHaveAttribute("aria-sort", "descending")
  })

  it("filters client-side with a faceted filter and resets", async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        columns={columns}
        data={docs}
        toolbar={(table) => (
          <DataTableToolbar table={table}>
            <DataTableFacetedFilter
              title="Status"
              column={table.getColumn("status")}
              options={["Draft", "Sent", "Paid"].map((s) => ({ label: s, value: s }))}
            />
          </DataTableToolbar>
        )}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Status" }))
    await user.click(await screen.findByRole("option", { name: /Sent/ }))
    expect(bodyRows()).toHaveLength(1)
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Reset" }))
    expect(bodyRows()).toHaveLength(3)
  })

  it("uses manual pagination with rowCount and reports page changes", async () => {
    const user = userEvent.setup()
    const onPaginationChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        data={docs}
        rowCount={45}
        pagination={{ pageIndex: 0, pageSize: 20 }}
        onPaginationChange={onPaginationChange}
      />,
    )
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument()
    expect(screen.getByText("45 rows")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next page" }))
    const updater = onPaginationChange.mock.calls[0]![0] as (old: { pageIndex: number; pageSize: number }) => unknown
    expect(updater({ pageIndex: 0, pageSize: 20 })).toEqual({ pageIndex: 1, pageSize: 20 })
  })
})
