import * as React from "react"
import { ChevronDownIcon, DownloadIcon, RefreshCwIcon, UploadIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { renditionUrl } from "@/api/document"
import { useUpdateStatus } from "@/api/document-actions"
import { useMeta } from "@/api/meta"
import type { DocumentDetail, Status } from "@/api/types"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { KIND_LABEL, VIEWER_KINDS } from "./renditions"

/** Statuses that end the document's lifecycle: shown and confirmed as destructive. */
const FINAL: ReadonlySet<Status> = new Set(["Superseded"])

/**
 * "Change status" menu listing only the steps `meta.transitions[status]` allows (the server re-checks). Every step
 * is confirmed first: the lifecycle only moves forward, so a wrong choice cannot be undone from the document page.
 */
export function StatusMenu({ doc }: { doc: DocumentDetail }) {
  const meta = useMeta()
  const mutation = useUpdateStatus(doc.id)
  // `target` outlives `open` so the dialog keeps its text while it animates out.
  const [target, setTarget] = React.useState<Status | null>(null)
  const [open, setOpen] = React.useState(false)
  const next = meta.data?.transitions[doc.status] ?? []
  const name = doc.docNumber ?? doc.title
  const final = target !== null && FINAL.has(target)

  function choose(status: Status) {
    setTarget(status)
    setOpen(true)
  }

  async function apply() {
    if (!target) return
    await mutation.mutateAsync(target)
    toast.success(`Status changed to ${target}`)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={!meta.data || next.length === 0 || mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            Change status
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Move from {doc.status} to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {next.map((status) => (
            <DropdownMenuItem key={status} variant={FINAL.has(status) ? "destructive" : "default"} onSelect={() => choose(status)}>
              {status}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive={final}
        title={`Mark ${name} as ${target ?? ""}?`}
        description={
          final
            ? `${doc.title} becomes ${target ?? ""}. This ends its lifecycle; its status cannot change afterwards.`
            : `${doc.title} moves from ${doc.status} to ${target ?? ""}. This cannot be undone from the document page.`
        }
        confirmLabel={`Mark as ${target ?? ""}`}
        onConfirm={apply}
      />
    </>
  )
}

/** Download menu over the current version's files. */
export function DownloadMenu({ doc }: { doc: DocumentDetail }) {
  const files = VIEWER_KINDS.flatMap((kind) => doc.renditions.filter((r) => r.kind === kind))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={files.length === 0}>
          <DownloadIcon data-icon="inline-start" />
          Download
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Version {doc.currentVersion ?? ""}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {files.map((r) => (
          <DropdownMenuItem key={r.id} asChild>
            <a href={renditionUrl(doc.id, r.kind, { download: true })} download={r.displayName}>
              {KIND_LABEL[r.kind]}
              <span className="ml-auto text-xs text-muted-foreground">{r.filename.split(".").pop()?.toUpperCase()}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The document header's action bar: status, Regenerate (generated documents), Upload new version, Download. */
export function DocumentActions({ doc }: { doc: DocumentDetail }) {
  const docQuery = `documentId=${encodeURIComponent(doc.id)}`
  return (
    <div data-testid="document-actions" data-document={doc.id} className="flex flex-wrap items-center gap-2">
      <StatusMenu doc={doc} />
      {doc.template ? (
        <Button variant="outline" asChild>
          <Link to={`/generate/${encodeURIComponent(doc.template.id)}?${docQuery}`}>
            <RefreshCwIcon data-icon="inline-start" />
            Regenerate
          </Link>
        </Button>
      ) : null}
      <Button variant="outline" asChild>
        <Link to={`/upload?${docQuery}`}>
          <UploadIcon data-icon="inline-start" />
          Upload new version
        </Link>
      </Button>
      <DownloadMenu doc={doc} />
    </div>
  )
}
