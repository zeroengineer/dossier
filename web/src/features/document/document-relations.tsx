import { ArrowLeftIcon, ArrowRightIcon, Link2OffIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { useUnlinkDocument } from "@/api/document-actions"
import type { DocumentDetail, DocumentRelation } from "@/api/types"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AddLinkDialog, relationLabel } from "./add-link-dialog"

/**
 * The `DELETE /api/documents/:from/links?toId&type` call that removes `r`: outgoing links start at this document,
 * incoming ones at the other document; a template end is `template:<id>@<version>`.
 */
export function unlinkTarget(docId: string, r: DocumentRelation): { fromId: string; toId: string; type: string } | null {
  if (r.direction === "out") {
    if (r.document) return { fromId: docId, toId: r.document.id, type: r.type }
    if (r.template) return { fromId: docId, toId: `template:${r.template.id}@${r.template.version}`, type: r.type }
    return null
  }
  return r.document ? { fromId: r.document.id, toId: docId, type: r.type } : null
}

function otherEnd(r: DocumentRelation): string {
  if (r.document) return r.document.docNumber ?? r.document.title
  if (r.template) return `template ${r.template.id} v${r.template.version}`
  return "the other end"
}

function RemoveLink({ doc, relation }: { doc: DocumentDetail; relation: DocumentRelation }) {
  const mutation = useUnlinkDocument()
  const target = unlinkTarget(doc.id, relation)
  if (!target) return null
  const label = relation.direction === "out" ? relationLabel(relation.type) : `${relationLabel(relation.type)} (incoming)`
  return (
    <ConfirmDialog
      title="Remove this link?"
      description={`The "${label}" link between ${doc.docNumber ?? doc.title} and ${otherEnd(relation)} is removed. Both documents stay as they are.`}
      confirmLabel="Remove link"
      pending={mutation.isPending}
      onConfirm={() =>
        mutation.mutateAsync(target).then(({ removed }) => {
          if (removed) toast.success("Link removed")
          else toast.info("That link was already gone")
        })
      }
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`Remove link ${label} ${otherEnd(relation)}`}>
          <Link2OffIcon />
        </Button>
      }
    />
  )
}

/** Related documents in both directions (and template origins), each linking to the other end, with add/remove. */
export function DocumentRelations({ doc }: { doc: DocumentDetail }) {
  const relations = doc.relations
  return (
    <Card>
      <CardHeader>
        <CardTitle>Related documents</CardTitle>
        <CardDescription>Links from this document and to it.</CardDescription>
        <CardAction>
          <AddLinkDialog doc={doc} />
        </CardAction>
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
                ) : (
                  <span className="flex-1" />
                )}
                <RemoveLink doc={doc} relation={r} />
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
