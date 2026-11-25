import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { TriangleAlertIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"
import { Link } from "react-router"
import { toast } from "sonner"
import { useSaveEntity } from "@/api/entities"
import { useMe } from "@/api/me"
import { useMeta } from "@/api/meta"
import type { EntityDetail } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { FULL_HEIGHT_BELOW_SM } from "@/lib/dialog"
import { cn } from "@/lib/utils"
import { AliasInput } from "./alias-input"
import { entityFormSchema, formValues, NO_BRAND, toEntityInput, type EntityFormValues } from "./entity-form"
import { entityPath, kindLabel } from "./labels"

interface EntityFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The entity to edit; omit to create one. */
  entity?: EntityDetail | null
  /** Kind preselected for a new entity (the current tab). */
  defaultKind?: string
  onSaved?: (entity: EntityDetail) => void
}

/** The server's answer to a failed save, shown above the fields (with a link to the entity a duplicate name belongs to). */
function SaveError({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null
  const existingId = api?.details["existingId"]
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{api ? api.code : "Could not save"}</AlertTitle>
      <AlertDescription>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        {typeof existingId === "number" ? (
          <Link to={entityPath(existingId)} className="underline underline-offset-4">
            Open the existing entity
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

/** Create or edit an entity: kind (new only), name, aliases (tag input), brand and attributes as a JSON object. */
export function EntityFormDialog({ open, onOpenChange, entity = null, defaultKind = "", onSaved }: EntityFormDialogProps) {
  const editing = entity !== null
  const { data: meta } = useMeta()
  const { data: me } = useMe()
  const save = useSaveEntity()
  const form = useForm<EntityFormValues>({ resolver: zodResolver(entityFormSchema), defaultValues: formValues(entity, defaultKind) })
  const formId = React.useId()

  // Start from the entity's current values (or a blank form) every time the dialog opens.
  const { reset } = form
  const resetSave = save.reset
  React.useEffect(() => {
    if (open) {
      reset(formValues(entity, defaultKind))
      resetSave()
    }
  }, [open, entity, defaultKind, reset, resetSave])

  async function onSubmit(values: EntityFormValues) {
    try {
      const saved = await save.mutateAsync(toEntityInput(values, entity))
      toast.success(editing ? "Entity saved" : `Created ${saved.name}`)
      onOpenChange(false)
      onSaved?.(saved)
    } catch {
      // Shown by SaveError from save.error.
    }
  }

  const kinds = meta?.entityKinds ?? []
  const brands = me?.brands ?? []
  const brand = form.watch("brand")
  const brandMissing = brand !== NO_BRAND && !brands.some((b) => b.id === brand)

  return (
    <Dialog open={open} onOpenChange={(next) => (save.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className={cn(FULL_HEIGHT_BELOW_SM, "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${entity.name}` : "New entity"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Renaming keeps the old name as an alias. Aliases can be added but not removed."
              : "A company, person, client, vendor or other name that documents refer to."}
          </DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {save.isError ? <SaveError error={save.error} /> : null}
          <FieldGroup>
            {editing ? null : (
              <Controller
                control={form.control}
                name="kind"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor={`${formId}-kind`}>Kind</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={save.isPending}>
                      <SelectTrigger id={`${formId}-kind`} className="w-full" aria-invalid={fieldState.invalid || undefined}>
                        <SelectValue placeholder="Choose a kind" />
                      </SelectTrigger>
                      <SelectContent>
                        {kinds.map((k) => (
                          <SelectItem key={k} value={k}>
                            {kindLabel(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            )}

            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={`${formId}-name`}>Name</FieldLabel>
                  <Input
                    {...field}
                    id={`${formId}-name`}
                    autoComplete="off"
                    aria-invalid={fieldState.invalid || undefined}
                    disabled={save.isPending}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="aliases"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={`${formId}-aliases`}>Aliases</FieldLabel>
                  <AliasInput
                    id={`${formId}-aliases`}
                    value={field.value}
                    onChange={field.onChange}
                    locked={entity?.aliases ?? []}
                    invalid={fieldState.invalid}
                    disabled={save.isPending}
                    aria-describedby={`${formId}-aliases-help`}
                  />
                  <FieldDescription id={`${formId}-aliases-help`}>
                    Other names this entity goes by (abbreviations, former names). Matched in search and when documents are filed.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="brand"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={`${formId}-brand`}>Brand</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={save.isPending}>
                    <SelectTrigger id={`${formId}-brand`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_BRAND}>None</SelectItem>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.shortName}
                        </SelectItem>
                      ))}
                      {brandMissing ? <SelectItem value={brand}>{brand}</SelectItem> : null}
                    </SelectContent>
                  </Select>
                  <FieldDescription>The brand this entity belongs to, for your own companies and group entities.</FieldDescription>
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="attrs"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={`${formId}-attrs`}>Attributes (JSON)</FieldLabel>
                  <Textarea
                    {...field}
                    id={`${formId}-attrs`}
                    rows={5}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder={'{"email": "someone@example.com"}'}
                    aria-invalid={fieldState.invalid || undefined}
                    disabled={save.isPending}
                  />
                  <FieldDescription>
                    A JSON object of extra details (email, address, tax ids). Leave empty for none
                    {editing ? "; keys you delete here are removed." : "."}
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
