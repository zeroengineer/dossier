import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircleIcon, UploadIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"
import type { Me, Meta } from "@/api/types"
import { useSeries } from "@/api/settings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { DropZone } from "./drop-zone"
import { PartyCombobox, TypeCombobox } from "./pickers"
import { erroredFields, levelsWithin, NEW_DOCUMENT_FIELDS, newDocumentSchema, type NewDocumentValues } from "./upload-data"
import { useUploadSubmit } from "./use-upload-submit"

/** Radix Select items cannot have an empty value; this stands for "leave it out" and is sent as nothing. */
const NONE = "__none__"
const fromSelect = (v: string) => (v === NONE ? "" : v)
const toSelect = (v: string) => (v === "" ? NONE : v)

function defaultsFor(meta: Meta, me: Me): NewDocumentValues {
  const levels = levelsWithin(meta.sensitivityLevels, me.user.clearance)
  return {
    type: "",
    title: "",
    partyId: "",
    partyType: "",
    docNumber: "",
    numberSeries: "",
    docDate: "",
    dueDate: "",
    amount: "",
    currency: "",
    status: meta.statuses.includes("Draft") ? "Draft" : (meta.statuses[0] ?? ""),
    sensitivity: levels.includes("Internal") ? "Internal" : (levels.at(-1) ?? ""),
  }
}

/** Upload a file as a new document with its metadata. */
export function NewDocumentForm({ meta, me }: { meta: Meta; me: Me }) {
  const maxBytes = meta.limits.uploadMaxBytes
  const { file, chooseFile, submit, pending, fileError, submitError } = useUploadSubmit({ mode: "document", maxBytes })
  const series = useSeries()
  const levels = levelsWithin(meta.sensitivityLevels, me.user.clearance)
  const form = useForm<NewDocumentValues>({ resolver: zodResolver(newDocumentSchema), defaultValues: defaultsFor(meta, me) })
  const partyId = useWatch({ control: form.control, name: "partyId" })

  async function onSubmit(values: NewDocumentValues) {
    const err = await submit(values)
    if (!err) return
    for (const name of erroredFields(err, NEW_DOCUMENT_FIELDS)) {
      // The full server message is in the Alert below the form; the field only gets a short pointer.
      form.setError(name, { type: "server", message: "Check this field." })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6" aria-label="Upload a new document">
      <Card>
        <CardHeader>
          <CardTitle>File</CardTitle>
          <CardDescription>The file is stored as it is; its text is extracted for search.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field data-invalid={fileError ? true : undefined}>
            <DropZone file={file} onFileChange={chooseFile} maxBytes={maxBytes} disabled={pending} invalid={Boolean(fileError)} />
            {fileError ? <FieldError>{fileError}</FieldError> : null}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Only the type is required. Blank fields are left empty; you can edit them later.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-6 md:grid-cols-2">
            <Controller
              control={form.control}
              name="type"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-type">Type</FieldLabel>
                  <TypeCombobox id="upload-type" value={field.value} onChange={field.onChange} types={meta.documentTypes} invalid={fieldState.invalid} disabled={pending} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="title"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-title">Title</FieldLabel>
                  <Input id="upload-title" placeholder={file ? file.name.replace(/\.[^.]+$/, "") : "Defaults to the file name"} aria-invalid={fieldState.invalid || undefined} disabled={pending} {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="partyId"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-party">Party</FieldLabel>
                  <PartyCombobox
                    id="upload-party"
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v)
                      if (v === "") form.setValue("partyType", "")
                    }}
                    invalid={fieldState.invalid}
                    disabled={pending}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="partyType"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-party-type">Party type</FieldLabel>
                  <Select value={toSelect(field.value)} onValueChange={(v) => field.onChange(fromSelect(v))} disabled={pending || partyId === ""}>
                    <SelectTrigger id="upload-party-type" className="w-full" aria-invalid={fieldState.invalid || undefined}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>From the party's kind</SelectItem>
                      {meta.partyTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="docNumber"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-number">Number</FieldLabel>
                  <Input id="upload-number" placeholder="ACM-2026-0001" autoComplete="off" aria-invalid={fieldState.invalid || undefined} disabled={pending} {...field} />
                  <FieldDescription>The number printed on the file, if any. Nothing is drawn from a counter.</FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="numberSeries"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-series">Number series</FieldLabel>
                  <Select value={toSelect(field.value)} onValueChange={(v) => field.onChange(fromSelect(v))} disabled={pending}>
                    <SelectTrigger id="upload-series" className="w-full" aria-invalid={fieldState.invalid || undefined}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No series</SelectItem>
                      {(series.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.id}
                          <span className="text-muted-foreground">{s.pattern}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{series.isError ? "Could not load the series." : "Used to detect a number that is already taken."}</FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="docDate"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-date">Date</FieldLabel>
                  <Input id="upload-date" type="date" aria-invalid={fieldState.invalid || undefined} disabled={pending} {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="dueDate"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-due">Due or expiry date</FieldLabel>
                  <Input id="upload-due" type="date" aria-invalid={fieldState.invalid || undefined} disabled={pending} {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="amount"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-amount">Amount</FieldLabel>
                  <Input id="upload-amount" inputMode="decimal" placeholder="1,234.50" autoComplete="off" aria-invalid={fieldState.invalid || undefined} disabled={pending} {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="currency"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-currency">Currency</FieldLabel>
                  <Input
                    id="upload-currency"
                    placeholder={me.workspace.locale.currencyCode}
                    maxLength={3}
                    autoComplete="off"
                    aria-invalid={fieldState.invalid || undefined}
                    disabled={pending}
                    {...field}
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  />
                  <FieldDescription>Three-letter code; with an amount it defaults to {me.workspace.locale.currencyCode}.</FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="status"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-status">Status</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                    <SelectTrigger id="upload-status" className="w-full" aria-invalid={fieldState.invalid || undefined}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {meta.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="sensitivity"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="upload-sensitivity">Sensitivity</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                    <SelectTrigger id="upload-sensitivity" className="w-full" aria-invalid={fieldState.invalid || undefined}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {levels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Up to your clearance ({me.user.clearance}).</FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <UploadFooter error={submitError} pending={pending} />
    </form>
  )
}

/** The error Alert (if any) and the submit button, shared by both upload modes. */
export function UploadFooter({ error, pending, disabled = false, label = "Upload" }: { error: string | null; pending: boolean; disabled?: boolean; label?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || disabled}>
          {pending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
          {pending ? "Uploading…" : label}
        </Button>
      </div>
    </div>
  )
}
