import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { TriangleAlertIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { useRelateEntity } from "@/api/entities"
import { useMeta } from "@/api/meta"
import type { EntityDetail, EntitySummary } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { EntityPicker } from "./entity-picker"
import { roleLabel } from "./labels"

const schema = z.object({
  role: z.string().min(1, "Relation is required"),
  target: z.custom<EntitySummary | null>((v) => v !== null && v !== undefined, "Related entity is required"),
})
type Values = z.infer<typeof schema>

interface AddRelationDialogProps {
  entity: EntityDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Relate the entity to another one: `<entity> <role> <target>` (role from `meta.entityRelationRoles`). */
export function AddRelationDialog({ entity, open, onOpenChange }: AddRelationDialogProps) {
  const { data: meta } = useMeta()
  const relate = useRelateEntity(entity.id)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { role: "", target: null } })
  const formId = React.useId()

  const { reset } = form
  const resetRelate = relate.reset
  React.useEffect(() => {
    if (open) {
      reset({ role: "", target: null })
      resetRelate()
    }
  }, [open, reset, resetRelate])

  async function onSubmit(values: Values) {
    if (!values.target) return
    try {
      await relate.mutateAsync({ to: values.target.id, role: values.role })
      toast.success(`${entity.name} ${roleLabel(values.role)} ${values.target.name}`)
      onOpenChange(false)
    } catch {
      // Shown in the dialog from relate.error.
    }
  }

  const roles = meta?.entityRelationRoles ?? []
  const role = form.watch("role")
  const target = form.watch("target")
  const err = relate.error

  return (
    <Dialog open={open} onOpenChange={(next) => (relate.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add relation</DialogTitle>
          <DialogDescription>
            Relate {entity.name} to another entity, for example a person employed by a company.
          </DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {err ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>{err instanceof ApiError ? err.code : "Could not add the relation"}</AlertTitle>
              <AlertDescription>{err.message}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Controller
              control={form.control}
              name="role"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={`${formId}-role`}>Relation</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={relate.isPending}>
                    <SelectTrigger id={`${formId}-role`} className="w-full" aria-invalid={fieldState.invalid || undefined}>
                      <SelectValue placeholder="Choose a relation" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="target"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={`${formId}-target`}>Related entity</FieldLabel>
                  <EntityPicker
                    id={`${formId}-target`}
                    value={field.value ?? null}
                    onChange={field.onChange}
                    excludeId={entity.id}
                    invalid={fieldState.invalid}
                    disabled={relate.isPending}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <FieldDescription data-testid="relation-preview">
              {entity.name} <em>{role ? roleLabel(role) : "…"}</em> {target ? target.name : "…"}
            </FieldDescription>
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={relate.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={relate.isPending}>
            {relate.isPending ? <Spinner data-icon="inline-start" /> : null}
            Add relation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
