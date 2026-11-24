import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import { Link } from "react-router"
import type { DocumentRelation } from "@/api/types"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/** `based_on` → `based on`. */
const relationLabel = (type: string) => type.replaceAll("_", " ")

/** Related documents in both directions (and template origins), each linking to the other end. */
export function DocumentRelations({ relations }: { relations: DocumentRelation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Related documents</CardTitle>
        <CardDescription>Links from this document and to it.</CardDescription>
      </CardHeader>
      <CardContent>
        {relations.length ? (
          <ul className="flex flex-col divide-y" aria-label="Relations">
            {relations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  {r.direction === "out" ? <ArrowRightIcon className="size-4" aria-hidden /> : <ArrowLeftIcon className="size-4" aria-hidden />}
                  <span>{r.direction === "out" ? relationLabel(r.type) : `${relationLabel(r.type)} (incoming)`}</span>
                </span>
                {r.document ? (
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <Link to={`/documents/${encodeURIComponent(r.document.id)}`} className="truncate font-medium underline-offset-4 hover:underline">
                      {r.document.title}
                    </Link>
                    <span className="text-xs text-muted-foreground tabular-nums">{r.document.docNumber ?? r.document.id}</span>
                    <Badge variant="secondary">{r.document.type}</Badge>
                    <StatusBadge status={r.document.status} />
                  </span>
                ) : r.template ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="font-medium">Template {r.template.id}</span>
                    <Badge variant="secondary">v{r.template.version}</Badge>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No related documents.</p>
        )}
      </CardContent>
    </Card>
  )
}
