import * as React from "react"
import type { UseFormReturn } from "react-hook-form"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { CircleAlertIcon, FilePlusIcon, LockIcon, RefreshCwIcon } from "lucide-react"
import { useGenerateDocument } from "@/api/generate"
import type { DocumentDetail, GenerateRequest, GenerateResult, TemplateDetail } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { toastError } from "@/lib/query-client"
import { setFieldProblems, toFieldProblems, type FieldProblem } from "./problems"
import { toInput, type FormValues } from "./to-input"

/** STATUS_LOCKED: a plain regenerate of the document was refused; `status` is its status from the error details. */
interface Locked {
  status: string
}

interface UseGenerateActionOptions {
  template: TemplateDetail
  form: UseFormReturn<FormValues>
  /** The page's brand (null: the workspace default). Not sent on a regenerate: the document keeps its brand. */
  brandId: string | null
  /** The document being regenerated, or null for a new document. */
  regenerate: DocumentDetail | null
}

export type GenerateAction = ReturnType<typeof useGenerateAction>

/**
 * Generate (or regenerate) from the form: `onValid` is the form's submit handler (after the schema passed). Field
 * problems from the server (FIELDS_MISSING, FIELDS_INVALID) go on the fields and into an alert; STATUS_LOCKED opens
 * the force choice; anything else is toasted. On success: a toast with the number, then the document page.
 */
export function useGenerateAction({ template, form, brandId, regenerate }: UseGenerateActionOptions) {
  const navigate = useNavigate()
  const mutation = useGenerateDocument(template.id)
  const [note, setNote] = React.useState("")
  const [force, setForce] = React.useState(false)
  const [locked, setLocked] = React.useState<Locked | null>(null)
  const [problems, setProblems] = React.useState<FieldProblem[]>([])
  const marked = React.useRef<string[]>([])

  const show = (list: FieldProblem[]) => {
    setProblems(list)
    marked.current = setFieldProblems(form, list, marked.current)
    const first = list.find((p) => form.getFieldState(p.path).error)
    if (first) form.setFocus(first.path)
  }

  const onValid = (values: FormValues) => {
    const { input, errors, rowIndex } = toInput(template.fields, values)
    if (errors.length) {
      show(toFieldProblems(template.fields, { errors }, rowIndex))
      return
    }
    setProblems([])
    const trimmed = note.trim()
    const body: GenerateRequest = {
      input,
      ...(regenerate ? { documentId: regenerate.id, ...(force ? { force: true } : {}) } : brandId ? { brandId } : {}),
      ...(regenerate && trimmed ? { note: trimmed } : {}),
    }
    mutation.mutate(body, {
      onSuccess: (r) => {
        setLocked(null)
        notifyGenerated(r, Boolean(regenerate))
        void navigate(`/documents/${encodeURIComponent(r.documentId)}`)
      },
      onError: (err) => {
        if (err instanceof ApiError && (err.code === "FIELDS_MISSING" || err.code === "FIELDS_INVALID")) {
          show(toFieldProblems(template.fields, err.details as Parameters<typeof toFieldProblems>[1], rowIndex))
        } else if (err instanceof ApiError && err.code === "STATUS_LOCKED") {
          const status = typeof err.details["status"] === "string" ? err.details["status"] : (regenerate?.status ?? "")
          setLocked({ status })
        } else {
          toastError(err)
        }
      },
    })
  }

  return { onValid, note, setNote, force, setForce, locked, problems, pending: mutation.isPending, regenerate }
}

function notifyGenerated(r: GenerateResult, regenerated: boolean) {
  const name = r.number ?? r.documentId
  const warnings = r.warnings.length ? ` ${r.warnings.length} placeholder${r.warnings.length === 1 ? "" : "s"} printed empty.` : ""
  if (regenerated) toast.success(`Regenerated ${name}`, { description: `Version ${r.versionNo} is now current.${warnings}` })
  else toast.success(`Generated ${name}`, warnings ? { description: warnings.trim() } : undefined)
}

interface GenerateActionBarProps {
  action: GenerateAction
  /** Regenerate mode: leave it and generate a new document from the same input instead (to supersede this one). */
  onGenerateNew?: () => void
}

/**
 * The bottom of the generate form: the field problems of the last attempt, in regenerate mode the version note and,
 * after STATUS_LOCKED, the choice between superseding (generate a new document) and forcing; then the submit button.
 */
export function GenerateActionBar({ action, onGenerateNew }: GenerateActionBarProps) {
  const { regenerate, problems, locked, force, setForce, note, setNote, pending } = action
  const docName = regenerate ? (regenerate.docNumber ?? regenerate.id) : ""
  return (
    <div className="flex flex-col gap-4 border-t pt-6">
      {problems.length ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>
            {problems.length === 1 ? "1 field needs attention" : `${problems.length} fields need attention`}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-0.5">
              {problems.map((p) => (
                <li key={`${p.path}:${p.message}`}>{`${p.label}: ${p.message}`}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {regenerate ? (
        <Field>
          <FieldLabel htmlFor="generate-note">Version note</FieldLabel>
          <Textarea
            id="generate-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed in this version (optional)"
            rows={2}
          />
        </Field>
      ) : null}

      {regenerate && locked ? (
        <Alert>
          <LockIcon />
          <AlertTitle>
            {docName} is {locked.status}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>
              A {locked.status} document cannot simply be regenerated. You can keep {docName} as it is and generate a new
              document from this input, then mark it as superseding {docName} on the new document's page. Or you can
              regenerate {docName} anyway: it keeps its number and gets a new version, and its status may change.
            </p>
            <Field orientation="horizontal">
              <Checkbox id="generate-force" checked={force} onCheckedChange={(v) => setForce(v === true)} />
              <FieldContent>
                <FieldLabel htmlFor="generate-force">Regenerate anyway</FieldLabel>
                <FieldDescription>Adds a new version to {docName} although it is {locked.status}.</FieldDescription>
              </FieldContent>
            </Field>
            {onGenerateNew ? (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={onGenerateNew}>
                  <FilePlusIcon data-icon="inline-start" />
                  Generate a new document instead
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Kept in view at the bottom of a long form. */}
      <div className="sticky bottom-0 flex justify-end bg-card py-3">
        <Button type="submit" disabled={pending || Boolean(regenerate && locked && !force)}>
          {pending ? <Spinner data-icon="inline-start" /> : regenerate ? <RefreshCwIcon data-icon="inline-start" /> : <FilePlusIcon data-icon="inline-start" />}
          {regenerate ? "Regenerate" : "Generate"}
        </Button>
      </div>
    </div>
  )
}
