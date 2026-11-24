import * as React from "react"
import { LayoutTemplateIcon, SearchIcon } from "lucide-react"
import { Link } from "react-router"
import { useMeta } from "@/api/meta"
import { useTemplates } from "@/api/templates"
import type { TemplateSummary } from "@/api/types"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { categoryLabel } from "@/features/templates/labels"
import { generatePath } from "@/features/templates/templates-table"

const matches = (t: TemplateSummary, q: string) =>
  [t.title, t.id, t.type, t.category, t.description ?? ""].some((s) => s.toLowerCase().includes(q))

/** Templates grouped by category: the workspace's category order (`meta.templateCategories`), unknown ones last. */
function groupByCategory(templates: TemplateSummary[], order: readonly string[]) {
  const groups = new Map<string, TemplateSummary[]>()
  for (const t of templates) groups.set(t.category, [...(groups.get(t.category) ?? []), t])
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length)
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
}

/** The template chooser of `/generate`: one card per template, grouped by category, with a search box. */
export function TemplatePicker() {
  const { data, isPending, isError, error, refetch } = useTemplates()
  const { data: meta } = useMeta()
  const [query, setQuery] = React.useState("")
  const q = query.trim().toLowerCase()
  const templates = React.useMemo(() => (data?.templates ?? []).filter((t) => !q || matches(t, q)), [data, q])
  const groups = groupByCategory(templates, meta?.templateCategories ?? [])

  if (isError) return <ErrorState error={error} title="Could not load templates" onRetry={() => void refetch()} />

  return (
    <div className="flex flex-col gap-6">
      <InputGroup className="max-w-sm">
        <InputGroupInput
          type="search"
          aria-label="Search templates"
          placeholder="Search templates…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading templates">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : data.templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplateIcon}
          title="No templates"
          description="Add a template folder under templates/ in the workspace to generate documents from it."
        />
      ) : groups.length === 0 ? (
        <EmptyState icon={SearchIcon} title="No templates match" description={`Nothing matches “${query.trim()}”.`} />
      ) : (
        groups.map(([category, list]) => (
          <section key={category} aria-labelledby={`category-${category}`} className="flex flex-col gap-3">
            <h2 id={`category-${category}`} className="text-sm font-medium text-muted-foreground">
              {categoryLabel(category)}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((t) => (
                <li key={t.id} className="flex">
                  <TemplateCard template={t} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function TemplateCard({ template: t }: { template: TemplateSummary }) {
  return (
    <Card className="relative flex-1 transition-colors hover:bg-accent/50 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50">
      <CardHeader>
        <CardTitle>
          <Link to={generatePath(t.id)} className="outline-none after:absolute after:inset-0">
            {t.title}
          </Link>
        </CardTitle>
        {t.description ? <CardDescription className="line-clamp-2">{t.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="mt-auto flex flex-wrap gap-2">
        <Badge variant="secondary">{t.type}</Badge>
        <SensitivityBadge level={t.sensitivity} />
      </CardContent>
    </Card>
  )
}
