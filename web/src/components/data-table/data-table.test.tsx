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

  it("calls onRowClick with the row's item on click, Enter and Space", async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} data={docs} onRowClick={onRowClick} />)
    await user.click(screen.getByRole("cell", { name: "Stage invoice" }))
    expect(onRowClick).toHaveBeenLastCalledWith(docs[1])
    const row = bodyRows()[2]!
    row.focus()
    await user.keyboard("{Enter}")
    expect(onRowClick).toHaveBeenLastCalledWith(docs[2])
    bodyRows()[0]!.focus()
    await user.keyboard(" ")
    expect(onRowClick).toHaveBeenLastCalledWith(docs[0])
    expect(onRowClick).toHaveBeenCalledTimes(3)
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
    expect(screen.getByRole("option", { name: /Sent/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("option", { name: /Sent/ })).toHaveTextContent("(selected)")
    expect(screen.getByRole("option", { name: /Draft/ })).toHaveAttribute("aria-checked", "false")
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

  describe("client mode page reset", () => {
    // 25 rows, 10 per page: three pages. Odd rows are Draft, even rows Sent.
    const many: Doc[] = Array.from({ length: 25 }, (_, i) => ({
      id: `DOC-${String(i + 1).padStart(6, "0")}`,
      title: `Invoice ${String(i + 1).padStart(2, "0")}`,
      party: "Acme Events",
      status: i % 2 === 0 ? "Draft" : "Sent",
    }))
    const statusOptions = ["Draft", "Sent"].map((s) => ({ label: s, value: s }))

    function renderMany() {
      const user = userEvent.setup()
      render(
        <DataTable
          columns={columns}
          data={many}
          initialState={{ pagination: { pageIndex: 0, pageSize: 10 } }}
          toolbar={(table) => (
            <DataTableToolbar table={table} searchColumn="title" searchPlaceholder="Search titles">
              <DataTableFacetedFilter title="Status" column={table.getColumn("status")} options={statusOptions} />
            </DataTableToolbar>
          )}
        />,
      )
      return user
    }

    async function goToLastPage(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "Next page" }))
      await user.click(screen.getByRole("button", { name: "Next page" }))
      expect(screen.getByText("Page 3 of 3")).toBeInTheDocument()
    }

    it("returns to the first page when a search filters rows", async () => {
      const user = renderMany()
      await goToLastPage(user)
      await user.type(screen.getByRole("searchbox", { name: "Search titles" }), "Invoice 0")
      expect(screen.getByText("Page 1 of 1")).toBeInTheDocument()
      expect(bodyRows()).toHaveLength(9)
    })

    it("returns to the first page on a faceted filter and on Reset", async () => {
      const user = renderMany()
      await goToLastPage(user)
      await user.click(screen.getByRole("button", { name: "Status" }))
      await user.click(await screen.findByRole("option", { name: /Sent/ }))
      await user.keyboard("{Escape}")
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument()
      expect(bodyRows()).toHaveLength(10)
      await user.click(screen.getByRole("button", { name: "Next page" }))
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "Reset" }))
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument()
      expect(within(bodyRows()[0]!).getByRole("cell", { name: "Invoice 01" })).toBeInTheDocument()
    })

    it("returns to the first page when the sort changes", async () => {
      const user = renderMany()
      await goToLastPage(user)
      await user.click(screen.getByRole("button", { name: "Title" }))
      await user.click(await screen.findByRole("menuitem", { name: "Descending" }))
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument()
      expect(within(bodyRows()[0]!).getByRole("cell", { name: "Invoice 25" })).toBeInTheDocument()
    })
  })

  describe("server mode", () => {
    it("shows data as given (no client sort, filter or slicing) and stays manual while rowCount is unknown", async () => {
      const user = userEvent.setup()
      const onSortingChange = vi.fn()
      const onPaginationChange = vi.fn()
      const page = Array.from({ length: 25 }, (_, i) => ({ ...docs[0]!, id: `DOC-${i}`, title: `Row ${25 - i}` }))
      const { rerender } = render(
        <DataTable
          mode="server"
          columns={columns}
          data={page}
          pagination={{ pageIndex: 1, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
          sorting={[]}
          onSortingChange={onSortingChange}
        />,
      )
      // rowCount undefined (still loading the count): no client-side slicing to 10 rows, page index untouched.
      expect(bodyRows()).toHaveLength(25)
      expect(onPaginationChange).not.toHaveBeenCalled()

      await user.click(screen.getByRole("button", { name: "Title" }))
      await user.click(await screen.findByRole("menuitem", { name: "Ascending" }))
      expect(onSortingChange).toHaveBeenCalledTimes(1)
      // Server mode leaves the page index to the caller.
      expect(onPaginationChange).not.toHaveBeenCalled()

      rerender(
        <DataTable
          mode="server"
          columns={columns}
          data={page.slice(0, 10)}
          rowCount={45}
          pagination={{ pageIndex: 1, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
          sorting={[{ id: "title", desc: false }]}
          onSortingChange={onSortingChange}
        />,
      )
      expect(screen.getByText("Page 2 of 5")).toBeInTheDocument()
      expect(within(bodyRows()[0]!).getByRole("cell", { name: "Row 25" })).toBeInTheDocument()
    })
  })
})
