import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type UseFormReturn } from "react-hook-form"
import type { TemplateDetail } from "@/api/types"
import { FieldGroup } from "@/components/ui/field"
import { TemplateFieldInput } from "./fields"
import { fieldsToZod, toFormValues } from "./schema"
import type { FormValues } from "./to-input"

/**
 * The react-hook-form instance of a template's generate form: values start empty (or from `input`, when
 * regenerating) and are checked against `fieldsToZod`. Read them for the API with `toInput(template.fields, values)`.
 */
export function useGenerateForm(template: TemplateDetail, input?: Record<string, unknown>) {
  const { fields, meta } = template
  // Computed once: later renders (a brand switch) must not rebuild the initial values.
  const [defaultValues] = React.useState(() => toFormValues(fields, meta.fields, input))
  const resolver = React.useMemo(() => zodResolver(fieldsToZod(fields, meta.fields)), [fields, meta.fields])
  return useForm<FormValues>({
    // Initial values only: a brand switch refetches the fields (same names) and keeps what was typed.
    defaultValues,
    resolver,
    mode: "onTouched",
  })
}

interface GenerateFieldsProps {
  template: TemplateDetail
  form: UseFormReturn<FormValues>
}

/** Every input field of the template, in template order. */
export function GenerateFields({ template, form }: GenerateFieldsProps) {
  return (
    <FieldGroup>
      {template.fields.map((f) => (
        <TemplateFieldInput
          key={f.name}
          field={f}
          control={form.control}
          meta={template.meta.fields.find((m) => m.name === f.name)}
        />
      ))}
    </FieldGroup>
  )
}
