import * as React from "react"
import type { PaginationState, Updater, VisibilityState } from "@tanstack/react-table"
import { useNavigate, useSearchParams } from "react-router"
import { useDocuments } from "@/api/documents"
import { useMeta } from "@/api/meta"
import type { DocumentSummary, Status } from "@/api/types"
import { DataTable, DataTableFacetedFilter, DataTableToolbar, type FacetOption } from "@/components/data-table"
import { ErrorState } from "@/components/error-state"
import { documentColumns } from "./columns"
import { DateRangeFilter } from "./date-range-filter"
import { PartyFilter } from "./party-filter"
import { hasFilters, parseDocumentsSearch, toListParams, toSearchParams, type DocumentsSearch } from "./search-params"

const VISIBILITY_KEY = "dossier.documents.columns"

function readVisibility(): VisibilityState {
  try {
    const raw = window.localStorage.getItem(VISIBILITY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "boolean")) as VisibilityState
  } catch {
    return {}
  }
}

function writeVisibility(state: VisibilityState) {
  try {
    window.localStorage.setItem(VISIBILITY_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable (private mode, quota): the choice lasts for this page view only.
  }
}

/** Options from a list, plus the active value when the list lacks it (a type typed into the URL by hand). */
function optionsOf(values: readonly string[] | undefined, active: string | undefined): FacetOption[] {
  const list = [...(values ?? [])]
  if (active && !list.includes(active)) list.push(active)
  return list.map((v) => ({ label: v, value: v }))
}

/**
 * Every document the user may see, paged and filtered on the server. Filters and paging live in the URL
 * (`type`, `status`, `partyId`, `from`, `to`, `page`, `size`); column visibility is remembered per browser.
 */
export function DocumentsTable() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = parseDocumentsSearch(searchParams)
  const { data: meta } = useMeta()
  const query = useDocuments(toListParams(search))
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(readVisibility)

  function update(patch: Partial<DocumentsSearch>, { keepPage = false } = {}) {
    setSearchParams(toSearchParams({ ...search, ...patch, page: keepPage ? (patch.page ?? search.page) : 1 }))
  }

  function onPaginationChange(updater: Updater<PaginationState>) {
    const current = { pageIndex: search.page - 1, pageSize: search.size }
    const next = typeof updater === "function" ? updater(current) : updater
    if (next.pageSize !== current.pageSize) update({ size: next.pageSize })
    else update({ page: next.pageIndex + 1 }, { keepPage: true })
  }

  function onColumnVisibilityChange(updater: Updater<VisibilityState>) {
    setColumnVisibility((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater
      writeVisibility(next)
      return next
    })
  }

  const filtered = hasFilters(search)
  const rows: DocumentSummary[] = query.isError ? [] : (query.data?.documents ?? [])
  const empty = query.isError ? (
    <ErrorState error={query.error} title="Could not load documents" onRetry={() => void query.refetch()} className="border-none" />
  ) : filtered ? (
    "No documents match these filters."
  ) : (
    "No documents yet. Generate or upload one to get started."
  )

  return (
    <DataTable
      columns={documentColumns}
      data={rows}
      getRowId={(d) => d.id}
      onRowClick={(d) => navigate(`/documents/${encodeURIComponent(d.id)}`)}
      isLoading={query.isPending}
      empty={empty}
      mode="server"
      rowCount={query.isError ? 0 : query.data?.total}
      pagination={{ pageIndex: search.page - 1, pageSize: search.size }}
      onPaginationChange={onPaginationChange}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={onColumnVisibilityChange}
      toolbar={(table) => (
        <DataTableToolbar table={table} isFiltered={filtered} onReset={() => setSearchParams(toSearchParams({ page: 1, size: search.size }))}>
          <DataTableFacetedFilter
            title="Type"
            single
            options={optionsOf(meta?.documentTypes, search.type)}
            selected={search.type ? [search.type] : []}
            onSelectedChange={(values) => update({ type: values[0] })}
          />
          <DataTableFacetedFilter
            title="Status"
            single
            options={optionsOf(meta?.statuses, search.status)}
            selected={search.status ? [search.status] : []}
            onSelectedChange={(values) => update({ status: values[0] as Status | undefined })}
          />
          <PartyFilter value={search.partyId} onChange={(partyId) => update({ partyId })} />
          <DateRangeFilter from={search.from} to={search.to} onChange={(range) => update(range)} />
        </DataTableToolbar>
      )}
    />
  )
}
