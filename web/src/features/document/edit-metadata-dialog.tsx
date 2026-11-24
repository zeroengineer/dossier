import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { PencilIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { useUpdateMetadata } from "@/api/document-actions"
import { useMeta } from "@/api/meta"
import type { DocumentDetail, DocumentMetadataPatch, SensitivityLevel } from "@/api/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { toastError } from "@/lib/query-client"

const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")])

const schema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  docNumber: z.string().trim(),
  docDate: optionalDate,
  dueDate: optionalDate,
  sensitivity: z.string().min(1, "Choose a sensitivity"),
})

type Values = z.infer<typeof schema>
const FIELDS = ["title", "docNumber", "docDate", "dueDate", "sensitivity"] as const

function valuesOf(doc: DocumentDetail): Values {
  return {
    title: doc.title,
    docNumber: doc.docNumber ?? "",
    docDate: doc.docDate ?? "",
    dueDate: doc.dueDate ?? "",
    sensitivity: doc.sensitivity,
  }
}

/** Only the fields that changed; an emptied number or date is sent as null (cleared). */
export function metadataPatch(doc: DocumentDetail, values: Values): DocumentMetadataPatch {
  const patch: DocumentMetadataPatch = {}
  const title = values.title.trim()
  if (title !== doc.title) patch.title = title
  const nullable = (v: string) => (v.trim() === "" ? null : v.trim())
  if (nullable(values.docNumber) !== doc.docNumber) patch.docNumber = nullable(values.docNumber)
  if (nullable(values.docDate) !== doc.docDate) patch.docDate = nullable(values.docDate)
  if (nullable(values.dueDate) !== doc.dueDate) patch.dueDate = nullable(values.dueDate)
  if (values.sensitivity !== doc.sensitivity) patch.sensitivity = values.sensitivity as SensitivityLevel
  return patch
}

/** Toast for a save the server accepted with warnings (e.g. NUMBER_CONFLICT). */
function warn(doc: DocumentDetail, warnings: string[]) {
  for (const code of warnings) {
    if (code === "NUMBER_CONFLICT") {
      toast.warning("Saved with a number conflict", {
        description: `Another document of ${doc.numberSeries ?? "the series"} already has number ${doc.docNumber ?? ""}.`,
      })
    } else {
      toast.warning(`Saved with a warning: ${code}`)
    }
  }
}

/** Edit Dialog for the document's title, number, dates and sensitivity (`POST /api/documents/:id/metadata`). */
export function EditMetadataDialog({ doc }: { doc: DocumentDetail }) {
  const [open, setOpen] = React.useState(false)
  const meta = useMeta()
  const mutation = useUpdateMetadata(doc.id)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: valuesOf(doc) })

  function onOpenChange(next: boolean) {
    if (!next && mutation.isPending) return
    if (next) form.reset(valuesOf(doc))
    setOpen(next)
  }

  async function onSubmit(values: Values) {
    const patch = metadataPatch(doc, values)
    if (Object.keys(patch).length === 0) {
      setOpen(false)
      return
    }
    try {
      const saved = await mutation.mutateAsync(patch)
      setOpen(false)
      if (saved.warnings.length) warn(saved, saved.warnings)
      else toast.success("Details saved")
    } catch (err) {
      // A validation error naming one of the form's fields goes onto that field; anything else is toasted.
      const field = err instanceof ApiError ? FIELDS.find((f) => Object.hasOwn(err.details, f)) : undefined
      if (field && err instanceof ApiError && err.code === "INVALID_INPUT") form.setError(field, { message: err.message })
      else toastError(err)
    }
  }

  const levels = meta.data?.sensitivityLevels ?? [doc.sensitivity]
  const pending = mutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>Change the title, number, dates or sensitivity of {doc.id}.</DialogDescription>
        </DialogHeader>
        <form id="edit-metadata" noValidate onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}>
          <FieldGroup>
            <Controller
              name="title"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="meta-title">Title</FieldLabel>
                  <Input id="meta-title" aria-invalid={fieldState.invalid} {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="docNumber"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="meta-number">Number</FieldLabel>
                  <Input id="meta-number" className="tabular-nums" aria-invalid={fieldState.invalid} {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                name="docDate"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="meta-date">Document date</FieldLabel>
                    <Input id="meta-date" type="date" aria-invalid={fieldState.invalid} {...field} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name="dueDate"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="meta-due">Due / expiry date</FieldLabel>
                    <Input id="meta-due" type="date" aria-invalid={fieldState.invalid} {...field} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>
            <Controller
              name="sensitivity"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="meta-sensitivity">Sensitivity</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="meta-sensitivity" aria-invalid={fieldState.invalid} className="w-full">
                      <SelectValue placeholder="Choose a level" />
                    </SelectTrigger>
                    <SelectContent>
                      {levels.map((level) => (
                        <SelectItem key={level} value={level}>{level}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button type="submit" form="edit-metadata" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
