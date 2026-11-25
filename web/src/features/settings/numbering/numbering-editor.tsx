import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"
import { useForm, useFormState, useWatch, type Control, type FieldPath } from "react-hook-form"
import { toast } from "sonner"
import { useSaveSeries } from "@/api/settings"
import type { SeriesEntry } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { errorMessage } from "@/lib/api"
import { RowsEditor } from "../rows-editor"
import { SaveBar } from "../save-bar"
import { Section } from "../section"
import { applyServerErrors, type UnplacedError } from "../server-errors"
import { UnsavedChangesGuard } from "../unsaved-guard"
import { BLANK_SERIES, toSeriesFormValues, toSeriesList, type SeriesFormValues } from "./series-form"

const FORM_ID = "numbering-form"

/** Series id -> where it is used; null while loading, "unavailable" when the usage query failed. */
export type Usage = Record<string, string[]> | "unavailable" | null

interface NumberingEditorProps {
  series: SeriesEntry[]
  usage: Usage
  /** `meta.seriesScopes`. */
  scopes: string[]
}

/** series.json as rows (id, pattern, scope, start, shared counter), saved whole with `PUT /api/series`. */
export function NumberingEditor({ series, usage, scopes }: NumberingEditorProps) {
  const [stored, setStored] = React.useState(series)
  const form = useForm<SeriesFormValues>({ defaultValues: toSeriesFormValues(series) })
  const { isDirty } = useFormState({ control: form.control })
  const save = useSaveSeries()
  const [failure, setFailure] = React.useState<{ error: unknown; unplaced: UnplacedError[] } | null>(null)

  const rows = useWatch({ control: form.control, name: "series" })
  const ids = [...new Set(rows.map((r) => r.id.trim()).filter(Boolean))]

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    form.clearErrors()
    setFailure(null)
    const { body, problems, fieldFor } = toSeriesList(form.getValues(), stored)
    if (problems.length) {
      for (const p of problems) form.setError(p.field as FieldPath<SeriesFormValues>, { type: "client", message: p.message })
      toast.error("Not saved", { description: "Fix the marked fields." })
      return
    }
    try {
      const saved = await save.mutateAsync(body)
      setStored(saved)
      form.reset(toSeriesFormValues(saved))
      toast.success("Series saved")
    } catch (err) {
      const { unplaced } = applyServerErrors(err, form.setError, fieldFor, "series.json")
      setFailure({ error: err, unplaced })
      toast.error("Not saved", { description: errorMessage(err) })
    }
  }

  return (
    <>
      <form id={FORM_ID} onSubmit={(e) => void onSubmit(e)} noValidate aria-label="Numbering series" className="flex flex-col gap-4">
        {failure ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Not saved</AlertTitle>
            <AlertDescription>
              <p>{errorMessage(failure.error)}</p>
              {failure.unplaced.length ? (
                <ul className="list-inside list-disc">
                  {failure.unplaced.map((u) => <li key={u.text}>{u.text}</li>)}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <Section
          title="Series"
          description={(
            <>
              Tokens: <code>{"{YYYY}"}</code> <code>{"{YY}"}</code> <code>{"{MM}"}</code> <code>{"{FY}"}</code>{" "}
              <code>{"{BRAND}"}</code> <code>{"{CLIENT}"}</code> <code>{"{CODE}"}</code> and one counter such as{" "}
              <code>{"{####}"}</code>. A series that shares a counter must name a series that owns its own counter and use the
              same scope. Renaming a series keeps only the fields shown here.
            </>
          )}
        >
          <RowsEditor
            control={form.control}
            name="series"
            blank={BLANK_SERIES}
            rowLabel={(i) => `series ${i + 1}`}
            addLabel="Add series"
            empty="No series yet."
            gridColumns={4}
            columns={[
              { key: "id", label: "Id" },
              { key: "pattern", label: "Pattern", placeholder: "ACM-{YYYY}-{####}", wide: true },
              { key: "scope", label: "Counter restarts per", options: [{ value: "", label: "Default (brand+year)" }, ...scopes.map((s) => ({ value: s, label: s }))] },
              { key: "start", label: "Start", placeholder: "1" },
              { key: "counter", label: "Shares the counter of", options: [{ value: "", label: "Own counter" }, ...ids.map((s) => ({ value: s, label: s }))] },
            ]}
            rowExtra={(i) => <UsageLine control={form.control} index={i} usage={usage} />}
          />
        </Section>
      </form>
      <SaveBar
        form={FORM_ID}
        dirty={isDirty}
        saving={save.isPending}
        onDiscard={() => {
          form.reset()
          setFailure(null)
        }}
        saveLabel="Save series"
      />
      <UnsavedChangesGuard dirty={isDirty} what="the series" />
    </>
  )
}

/** Where row `index`'s series is used (by its current id), from `GET /api/series/usage`. */
function UsageLine({ control, index, usage }: { control: Control<SeriesFormValues>; index: number; usage: Usage }) {
  const id = useWatch({ control, name: `series.${index}.id` }).trim()
  if (!usage || !id) return null
  if (usage === "unavailable") return <p className="text-sm text-muted-foreground">Usage unavailable</p>
  const uses = usage[id] ?? []
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium">Used by:</span> {uses.length ? uses.join(", ") : "not used by any brand or template"}
    </p>
  )
}
