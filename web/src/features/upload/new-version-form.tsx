import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { Link } from "react-router"
import { useDocument } from "@/api/document"
import type { Meta } from "@/api/types"
import { ErrorState } from "@/components/error-state"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { DropZone } from "./drop-zone"
import { UploadFooter } from "./new-document-form"
import { newVersionSchema, type NewVersionValues } from "./upload-data"
import { useUploadSubmit } from "./use-upload-submit"

/** The document a new version is uploaded to: its title, number, status and current version. */
function TargetDocument({ documentId }: { documentId: string }) {
  const doc = useDocument(documentId)
  if (doc.isPending) return <Skeleton className="h-16 w-full" />
  if (doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  const d = doc.data
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background p-3" data-testid="upload-target">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/documents/${encodeURIComponent(d.id)}`} className="font-medium underline-offset-4 hover:underline">
          {d.title || d.id}
        </Link>
        <StatusBadge status={d.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {[d.id, d.type, d.docNumber, d.currentVersion !== null ? `current version ${d.currentVersion}` : "no version yet"].filter(Boolean).join(" · ")}
      </p>
    </div>
  )
}

/** Upload a file as a new version of an existing document (`?documentId=`). */
export function NewVersionForm({ meta, documentId }: { meta: Meta; documentId: string }) {
  const maxBytes = meta.limits.uploadMaxBytes
  const { file, chooseFile, submit, pending, fileError, submitError } = useUploadSubmit({ mode: "version", maxBytes })
  const target = useDocument(documentId)
  const form = useForm<NewVersionValues>({ resolver: zodResolver(newVersionSchema), defaultValues: { note: "", makeCurrent: true } })

  async function onSubmit(values: NewVersionValues) {
    if (target.isError) return
    await submit({ documentId, note: values.note, makeCurrent: values.makeCurrent })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6" aria-label="Upload a new version">
      <Card>
        <CardHeader>
          <CardTitle>New version</CardTitle>
          <CardDescription>
            The file becomes the next version of this document; its metadata stays as it is.{" "}
            <Link to="/upload" className="text-primary underline-offset-4 hover:underline">Upload a new document instead</Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <TargetDocument documentId={documentId} />
          <Field data-invalid={fileError ? true : undefined}>
            <DropZone
              file={file}
              onFileChange={chooseFile}
              maxBytes={maxBytes}
              disabled={pending}
              invalid={Boolean(fileError)}
            />
            {fileError ? <FieldError>{fileError}</FieldError> : null}
          </Field>
          <FieldGroup>
            <Controller
              control={form.control}
              name="note"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="upload-note">Version note</FieldLabel>
                  <Textarea id="upload-note" placeholder="What changed, e.g. countersigned copy" rows={3} disabled={pending} {...field} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="makeCurrent"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox id="upload-make-current" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} disabled={pending} />
                  <FieldContent>
                    <FieldLabel htmlFor="upload-make-current">Make this the current version</FieldLabel>
                    <FieldDescription>Otherwise it is kept in the version history and the current version stays as it is.</FieldDescription>
                  </FieldContent>
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      {/* No target to add a version to while it cannot be loaded (not found, no access, server down). */}
      <UploadFooter error={submitError} pending={pending} disabled={target.isError} label="Upload version" />
    </form>
  )
}
