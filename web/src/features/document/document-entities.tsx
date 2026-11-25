import { UsersIcon } from "lucide-react"
import type { DocumentEntityLink } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { kindLabel, roleLabel } from "@/features/entities/labels"
import { EntityLink } from "./document-metadata"

/** Parties and other entities linked to the document, with their roles. */
export function DocumentEntities({ entities }: { entities: DocumentEntityLink[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Parties and entities</CardTitle>
      </CardHeader>
      <CardContent>
        {entities.length ? (
          <ul className="flex flex-col divide-y" aria-label="Linked entities">
            {entities.map((e) => (
              <li key={`${e.role}:${e.id}`} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate"><EntityLink entity={e} /></span>
                  <span className="text-xs text-muted-foreground">{kindLabel(e.kind)}</span>
                </div>
                <Badge variant="outline">{roleLabel(e.role)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <UsersIcon className="size-4" />
            No linked entities.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
