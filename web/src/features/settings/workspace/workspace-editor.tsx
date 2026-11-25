import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"
import { useForm, useFormState, type FieldPath } from "react-hook-form"
import { useLocation } from "react-router"
import { toast } from "sonner"
import { useSaveWorkspaceFile } from "@/api/settings"
import type { Locale, WorkspaceFile } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { errorMessage } from "@/lib/api"
import { ListError, SelectField, TextField } from "../form-fields"
import { RowsEditor } from "../rows-editor"
import { SaveBar } from "../save-bar"
import { Section } from "../section"
import { applyServerErrors, type UnplacedError } from "../server-errors"
import { UnsavedChangesGuard } from "../unsaved-guard"
import {
  BLANK_ROUTE, BLANK_USER, LOCALE_PATHS, TOP_LEVEL_COUNT, toWorkspaceFile, toWorkspaceFormValues, type WorkspaceFormValues,
} from "./workspace-form"

const FORM_ID = "workspace-form"

const LOCALE_LABELS: Record<(typeof LOCALE_PATHS)[number], string> = {
  currencySymbol: "Currency symbol",
  currencyCode: "Currency code",
  numberLocale: "Number locale",
  "dateFormats.short": "Short date format",
  "dateFormats.long": "Long date format",
  "dateFormats.us": "US date format",
  "currencyWords.major": "Currency in words (major unit)",
  "currencyWords.minor": "Currency in words (minor unit)",
  "currencyWords.suffix": "Amount in words suffix",
}

interface WorkspaceEditorProps {
  file: WorkspaceFile
  brandIds: string[]
  /** The effective locale (`/api/me`): shown as the placeholder of a blank locale field. */
  locale: Locale | null
  /** The acting user's clearance (the clearance rule's ceiling). */
  myClearance: string | null
  clearances: string[]
  /** Default top-level folder names and their slot keys (`/api/meta`). */
  defaultTopLevel: string[]
  topKeys: string[]
}

/** workspace.json as one form: general, locale, folder hierarchy and users, saved whole with `PUT /api/workspace`. */
export function WorkspaceEditor({ file, brandIds, locale, myClearance, clearances, defaultTopLevel, topKeys }: WorkspaceEditorProps) {
  const [base, setBase] = React.useState(file)
  const form = useForm<WorkspaceFormValues>({ defaultValues: toWorkspaceFormValues(file) })
  const { isDirty } = useFormState({ control: form.control })
  const save = useSaveWorkspaceFile()
  const [failure, setFailure] = React.useState<{ error: unknown; unplaced: UnplacedError[] } | null>(null)
  const control = form.control

  // `/settings/workspace#users` (the Users settings link) scrolls to the users section.
  const { hash } = useLocation()
  React.useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: "start" })
  }, [hash])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    form.clearErrors()
    setFailure(null)
    const { body, problems, fieldFor } = toWorkspaceFile(form.getValues(), base, defaultTopLevel)
    if (problems.length) {
      for (const p of problems) form.setError(p.field as FieldPath<WorkspaceFormValues>, { type: "client", message: p.message })
      toast.error("Not saved", { description: "Fix the marked fields." })
      return
    }
    try {
      const saved = await save.mutateAsync(body)
      setBase(saved)
      form.reset(toWorkspaceFormValues(saved))
      toast.success("Workspace saved")
    } catch (err) {
      const { unplaced } = applyServerErrors(err, form.setError, fieldFor, "workspace.json")
      setFailure({ error: err, unplaced })
      toast.error("Not saved", { description: errorMessage(err) })
    }
  }

  const placeholderOf = (p: string) => {
    const v = p.split(".").reduce<unknown>((o, k) => (typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined), locale)
    return typeof v === "string" ? v : undefined
  }

  return (
    <>
      <form id={FORM_ID} onSubmit={(e) => void onSubmit(e)} noValidate aria-label="Workspace settings" className="flex flex-col gap-4">
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

        <Section title="General">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="name" label="Workspace name" />
            <SelectField control={control} name="defaultBrand" label="Default brand" options={brandIds.map((b) => ({ value: b, label: b }))} />
          </div>
        </Section>

        <Section title="Locale" description="Leave a field blank to use the default shown.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {LOCALE_PATHS.map((p) => (
              <TextField key={p} control={control} name={`locale.${p}`} label={LOCALE_LABELS[p]} placeholder={placeholderOf(p)} />
            ))}
          </div>
        </Section>

        <Section
          title="Folder hierarchy"
          description="The vault's ten top-level folder names (all blank uses the defaults shown; a blank one keeps its default name) and routing overrides per document type."
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: TOP_LEVEL_COUNT }, (_, i) => (
                <TextField
                  key={i}
                  control={control}
                  name={`hierarchy.topLevel.${i}.value`}
                  label={`Folder ${i + 1}${topKeys[i] ? ` (${topKeys[i]})` : ""}`}
                  placeholder={defaultTopLevel[i]}
                />
              ))}
            </div>
            <ListError control={control} name="hierarchy.topLevel" />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Routing</h3>
            <p className="text-sm text-muted-foreground">
              Where a document type is filed: a leaf name (<code>Agreements</code>) inside the party's folder, or a top-level
              folder name with an optional leaf (<code>06 Finance/Bank Statements</code>). Types not listed use the built-in
              table.
            </p>
            <RowsEditor
              control={control}
              name="hierarchy.routing"
              blank={BLANK_ROUTE}
              rowLabel={(i) => `route ${i + 1}`}
              addLabel="Add route"
              empty="No routing overrides."
              gridColumns={3}
              columns={[
                { key: "type", label: "Document type", placeholder: "Invoice" },
                { key: "value", label: "Route", placeholder: "Invoices and Receipts", wide: true },
              ]}
            />
          </div>
        </Section>

        <div id="users" className="scroll-mt-4">
          <Section
            title="Users"
            description={`Users not listed get Confidential. You cannot give anyone a clearance above your own${myClearance ? ` (${myClearance})` : ""}, or change or remove a user above it.`}
          >
            <RowsEditor
              control={control}
              name="users"
              blank={BLANK_USER}
              rowLabel={(i) => `user ${i + 1}`}
              addLabel="Add user"
              empty="No users listed."
              columns={[
                { key: "id", label: "User id" },
                { key: "clearance", label: "Clearance", options: [{ value: "", label: "Default (Confidential)" }, ...clearances.map((c) => ({ value: c, label: c }))] },
              ]}
            />
          </Section>
        </div>
      </form>
      <SaveBar form={FORM_ID} dirty={isDirty} saving={save.isPending} onDiscard={() => form.reset()} saveLabel="Save workspace" />
      <UnsavedChangesGuard dirty={isDirty} what="the workspace" />
    </>
  )
}
