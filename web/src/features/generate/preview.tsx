import * as React from "react"
import { useWatch, type UseFormReturn } from "react-hook-form"
import { CircleAlertIcon, ExternalLinkIcon, FileSearchIcon, TriangleAlertIcon } from "lucide-react"
import { usePreview, usePreviewText, type PreviewOk } from "@/api/generate"
import type { TemplateDetail } from "@/api/types"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDebounced } from "@/hooks/use-debounced"
import { cn } from "@/lib/utils"
import { labelOfPath, setFieldProblems, toFieldProblems, type FieldProblem } from "./problems"
import { toInput, type FormValues } from "./to-input"

/** How long the form must be still before a preview is asked for. */
export const PREVIEW_DEBOUNCE_MS = 600

export interface GeneratePreviewProps {
  template: TemplateDetail
  /** The generate form: watched for changes; its input is `toInput(template.fields, form.getValues())`. */
  form: UseFormReturn<FormValues>
  /** The brand selected on the page (null: the workspace default); sent as the preview's `brandId`. */
  brandId: string | null
  /** True while `template` is still the previous brand's fields: no previews until the new ones load. */
  isPlaceholderData: boolean
}

const KIND_ORDER = ["pdf", "html", "md"]
const KIND_LABEL: Record<string, string> = { pdf: "PDF", html: "HTML", md: "Markdown" }
const FRAME = "h-full min-h-96 w-full flex-1 rounded-md border bg-background"

/** `url?v=token`: a new draft under the same file name is never served from a stale cache. */
const versioned = (url: string, token: string) => `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(token)}`

/**
 * The live draft preview of the generate page. Every change that the form can turn into input (`toInput` without
 * problems) is sent, 600 ms after typing stops, to `POST /api/templates/:id/preview`; a newer change cancels the
 * request in flight. Missing and invalid fields come back as an alert and as errors on the fields (missing ones only
 * once the user touched them, or after a Generate attempt); placeholders that print empty are listed as warnings.
 */
export function GeneratePreview({ template, form, brandId, isPlaceholderData }: GeneratePreviewProps) {
  const values = useWatch({ control: form.control }) as FormValues
  const { fields } = template
  const { input, errors: inputErrors, rowIndex } = React.useMemo(() => toInput(fields, values), [fields, values])
  const inputJson = inputErrors.length ? null : JSON.stringify(input)
  const debounced = useDebounced(inputJson, PREVIEW_DEBOUNCE_MS)
  const query = usePreview(template.id, brandId, isPlaceholderData ? null : debounced)
  const result = query.data
  // The answer for the input on screen (not the previous one kept while the next loads).
  const current = !query.isPlaceholderData && debounced === inputJson ? result : undefined

  // The last draft that rendered stays visible (dimmed) while fields are missing or invalid.
  const [lastOk, setLastOk] = React.useState<PreviewOk | null>(null)
  React.useEffect(() => {
    if (result?.ok) setLastOk(result)
  }, [result])

  const { submitCount } = form.formState
  const problems = React.useMemo<FieldProblem[]>(() => {
    const list: FieldProblem[] = inputErrors.map((e) => ({
      path: e.name,
      label: labelOfPath(fields, e.name),
      message: e.message,
      missing: false,
    }))
    if (current && !current.ok) list.push(...toFieldProblems(fields, current, rowIndex))
    return list
  }, [current, fields, inputErrors, rowIndex])

  // Put the problems on the fields; only when they change (a JSON key, since `problems` is rebuilt on every keystroke).
  const problemsKey = JSON.stringify(problems)
  const marked = React.useRef<string[]>([])
  React.useEffect(() => {
    marked.current = setFieldProblems(form, problems, marked.current, { missingOnlyIfTouched: submitCount === 0 })
  }, [form, problemsKey, submitCount]) // `problemsKey` stands for `problems`

  const missing = problems.filter((p) => p.missing)
  const invalid = problems.filter((p) => !p.missing)
  const shown = result?.ok ? result : lastOk
  const updating = query.isFetching || (inputJson !== null && debounced !== inputJson)

  return (
    <section aria-labelledby="generate-preview-title" className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 id="generate-preview-title" className="font-heading text-base font-semibold">
            Preview
          </h2>
          <p className="text-xs text-muted-foreground">Draft, not numbered</p>
        </div>
        {updating && !isPlaceholderData ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner aria-label="Updating the preview" />
            Updating
          </span>
        ) : null}
      </div>

      {invalid.length ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Fix {invalid.length === 1 ? "this value" : "these values"} to update the preview</AlertTitle>
          <AlertDescription>
            <ProblemList problems={invalid} />
          </AlertDescription>
        </Alert>
      ) : null}
      {missing.length ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Fill in to preview</AlertTitle>
          <AlertDescription>
            <ProblemList problems={missing} />
          </AlertDescription>
        </Alert>
      ) : null}
      {result?.ok && result.warnings.length ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Printed empty</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-0.5">
              {result.warnings.map((w) => (
                <li key={`${w.name}:${w.message}`}>{w.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {query.isError ? (
          <ErrorState error={query.error} title="Could not render the preview" onRetry={() => void query.refetch()} />
        ) : shown ? (
          <PreviewFiles preview={shown} title={template.meta.title} stale={!result?.ok} />
        ) : query.isPending && query.fetchStatus === "fetching" ? (
          <Skeleton className="min-h-96 flex-1" aria-label="Loading the preview" />
        ) : (
          <EmptyState
            icon={FileSearchIcon}
            title="No preview yet"
            description="A draft of the document appears here once the required fields are filled in."
            className="h-full border-dashed"
          />
        )}
      </div>
    </section>
  )
}

function ProblemList({ problems }: { problems: FieldProblem[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {problems.map((p) => (
        <li key={`${p.path}:${p.message}`}>
          {p.missing ? p.label : `${p.label}: ${p.message}`}
        </li>
      ))}
    </ul>
  )
}

/** Tabs over the draft's renditions: PDF iframed, HTML in a sandboxed iframe, Markdown as text. */
function PreviewFiles({ preview, title, stale }: { preview: PreviewOk; title: string; stale: boolean }) {
  const renditions = [...preview.renditions].sort((a, b) => rank(a.kind) - rank(b.kind))
  const [picked, setPicked] = React.useState<string | null>(null)
  const active = renditions.find((r) => r.kind === picked) ?? renditions[0]
  if (!active) {
    return <EmptyState icon={FileSearchIcon} title="No files" description="This template renders no previewable files." />
  }
  return (
    <Tabs
      value={active.kind}
      onValueChange={setPicked}
      className={cn("min-h-0 flex-1 gap-3 transition-opacity", stale && "opacity-50")}
      aria-busy={stale || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          {renditions.map((r) => (
            <TabsTrigger key={r.kind} value={r.kind}>
              {KIND_LABEL[r.kind] ?? r.kind}
            </TabsTrigger>
          ))}
        </TabsList>
        <Button variant="outline" size="sm" asChild>
          <a href={versioned(active.url, preview.token)} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon data-icon="inline-start" />
            Open
          </a>
        </Button>
      </div>
      {renditions.map((r) => (
        <TabsContent key={r.kind} value={r.kind} className="flex min-h-0 flex-1 flex-col">
          <PreviewFile kind={r.kind} src={versioned(r.url, preview.token)} label={`${KIND_LABEL[r.kind] ?? r.kind} preview of ${title}`} active={r.kind === active.kind} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

const rank = (kind: string) => {
  const i = KIND_ORDER.indexOf(kind)
  return i === -1 ? KIND_ORDER.length : i
}

function PreviewFile({ kind, src, label, active }: { kind: string; src: string; label: string; active: boolean }) {
  if (kind === "pdf") return <iframe src={src} title={label} className={FRAME} />
  if (kind === "md") return <MarkdownPreview src={src} label={label} enabled={active} />
  // HTML (and anything else) is served with `CSP: sandbox`; the empty sandbox attribute keeps scripts off here too.
  return <iframe src={src} title={label} sandbox="" className={FRAME} />
}

function MarkdownPreview({ src, label, enabled }: { src: string; label: string; enabled: boolean }) {
  const query = usePreviewText(src, enabled)
  if (query.isError) return <ErrorState error={query.error} title="Could not load the Markdown" onRetry={() => void query.refetch()} />
  if (query.data === undefined) return <Skeleton className="min-h-96 flex-1" />
  return (
    <pre
      aria-label={label}
      className="min-h-96 flex-1 overflow-auto rounded-md border bg-muted/40 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words"
    >
      {query.data}
    </pre>
  )
}
