import * as React from "react"
import { useSearchParams } from "react-router"
import { SearchIcon, SearchXIcon } from "lucide-react"
import { useSearch } from "@/api/search"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { SearchResults, SearchResultsSkeleton } from "@/features/search/search-results"

/** The query box. Keyed on the URL query by the page, so it resets when the URL changes (palette, back button). */
function SearchForm({ initial, onSubmit }: { initial: string; onSubmit: (q: string) => void }) {
  const [value, setValue] = React.useState(initial)
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(value.trim())
      }}
    >
      <InputGroup className="h-10 max-w-2xl">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          name="q"
          aria-label="Search query"
          placeholder="Document number, title, party, entity or text…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus={initial === ""}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" variant="default">Search</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get("q") ?? "").trim()
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useSearch(q)

  const submit = (next: string) => setParams(next ? { q: next } : {})
  const empty = data && data.hits.length === 0 && data.related.length === 0 && data.entities.length === 0

  let body: React.ReactNode
  if (q === "") {
    body = (
      <EmptyState
        icon={SearchIcon}
        title="Search your workspace"
        description="Find documents by number, title, party or text, and the entities they mention."
      />
    )
  } else if (isError) {
    body = <ErrorState error={error} title="Search failed" onRetry={() => void refetch()} />
  } else if (isPending) {
    body = <SearchResultsSkeleton />
  } else if (empty) {
    body = <EmptyState icon={SearchXIcon} title={`No results for “${q}”`} description="Try fewer words or a document number." />
  } else if (data) {
    body = (
      <div className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined} aria-busy={isPlaceholderData || undefined}>
        <SearchResults result={data} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Search" description="Documents and entities across the workspace." />
      <SearchForm key={q} initial={q} onSubmit={submit} />
      {body}
    </div>
  )
}
