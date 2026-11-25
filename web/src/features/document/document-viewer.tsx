import { useState } from "react"
import { useSearchParams } from "react-router"
import { DownloadIcon, ExternalLinkIcon, FileQuestionIcon, FileXIcon } from "lucide-react"
import { renditionUrl, useRenditionText } from "@/api/document"
import type { DocumentRendition, DocumentVersion } from "@/api/types"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollableTabsList } from "@/components/scrollable-tabs-list"
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { useLatchedWhileActive } from "@/hooks/use-latched-while-active"
import { KIND_LABEL, formatBytes, originalPreview, viewerRenditions } from "./renditions"

const FRAME = "h-[75vh] min-h-96 w-full rounded-md border bg-background"

interface DocumentViewerProps {
  docId: string
  title: string
  /** The version on show (null when the document has no versions). */
  version: DocumentVersion | null
}

/**
 * Tabs over the version's renditions: PDF iframed natively, HTML in a sandboxed iframe, Markdown as text. The tab is
 * `?view=<kind>` (left out for the first one), so a reload or a shared link opens the same view; an unknown or missing
 * kind shows the first rendition. A panel stays mounted once opened, so switching back does not reload its frame.
 */
export function DocumentViewer({ docId, title, version }: DocumentViewerProps) {
  const renditions = viewerRenditions(version)
  const [params, setParams] = useSearchParams()
  const active = renditions.find((r) => r.kind === params.get("view")) ?? renditions[0] ?? null
  const versionNo = version?.versionNo ?? null
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const isOpened = (kind: string) => kind === active?.kind || opened.has(kind)
  const pick = (kind: string) => {
    if (active) setOpened((prev) => new Set(prev).add(active.kind))
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (kind === renditions[0]?.kind) next.delete("view")
      else next.set("view", kind)
      return next
    }, { replace: true })
  }

  return (
    <Card data-testid="document-viewer">
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardDescription>
          {version ? `Version ${version.versionNo}${version.isCurrent ? " (current)" : ""}` : "No versions"}
        </CardDescription>
        {active ? (
          <CardAction className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={renditionUrl(docId, active.kind, { versionNo })} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon data-icon="inline-start" />
                Open
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={renditionUrl(docId, active.kind, { versionNo, download: true })} download={active.displayName}>
                <DownloadIcon data-icon="inline-start" />
                Download
              </a>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {active ? (
          <Tabs value={active.kind} onValueChange={pick} className="gap-4">
            <ScrollableTabsList aria-label="View">
              {renditions.map((r) => (
                <TabsTrigger key={r.kind} value={r.kind}>
                  {KIND_LABEL[r.kind]}
                </TabsTrigger>
              ))}
            </ScrollableTabsList>
            {renditions.map((r) => (
              <TabsContent
                key={r.kind}
                value={r.kind}
                forceMount={isOpened(r.kind) ? true : undefined}
                className="flex flex-col gap-2 data-[state=inactive]:hidden"
              >
                <RenditionView docId={docId} title={title} versionNo={versionNo} rendition={r} active={r.kind === active.kind} />
                <p className="truncate text-xs text-muted-foreground">
                  {r.displayName} · {formatBytes(r.bytes)}
                  {r.pageCount !== null ? ` · ${r.pageCount} ${r.pageCount === 1 ? "page" : "pages"}` : ""}
                </p>
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <EmptyState
            icon={FileXIcon}
            title="No renditions"
            description={version ? `Version ${version.versionNo} has no stored files.` : "This document has no stored files yet."}
          />
        )}
      </CardContent>
    </Card>
  )
}

interface RenditionViewProps {
  docId: string
  title: string
  versionNo: number | null
  rendition: DocumentRendition
  /** Whether its tab is the one on show. A hidden panel keeps the version it last showed until it is shown again. */
  active: boolean
}

function RenditionView({ docId, title, versionNo: current, rendition, active }: RenditionViewProps) {
  const versionNo = useLatchedWhileActive(current, active)
  const src = renditionUrl(docId, rendition.kind, { versionNo })
  const label = `${KIND_LABEL[rendition.kind]} of ${title}`
  const kind = rendition.kind === "original" ? originalPreview(rendition.mime) : rendition.kind

  switch (kind) {
    case "pdf":
      return <iframe src={src} title={label} className={FRAME} />
    case "html":
    case "text":
      // Non-PDF files are served with `CSP: sandbox`; the empty sandbox attribute keeps scripts and forms off here too.
      return <iframe src={src} title={label} sandbox="" className={FRAME} />
    case "md":
      return <MarkdownView docId={docId} versionNo={versionNo} label={label} />
    case "image":
      return <img src={src} alt={label} className="max-h-[75vh] w-full rounded-md border bg-background object-contain" />
    default:
      return (
        <EmptyState
          icon={FileQuestionIcon}
          title="No inline preview"
          description={`${rendition.filename} (${rendition.mime}) cannot be shown here; download it to open it.`}
        />
      )
  }
}

function MarkdownView({ docId, versionNo, label }: { docId: string; versionNo: number | null; label: string }) {
  const query = useRenditionText(docId, "md", versionNo)
  if (query.isPending) return <Skeleton className="h-96 w-full" />
  if (query.isError) return <ErrorState error={query.error} title="Could not load the Markdown" onRetry={() => void query.refetch()} />
  return (
    <pre
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-[75vh] min-h-96 overflow-auto rounded-md border bg-muted/40 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {query.data}
    </pre>
  )
}
