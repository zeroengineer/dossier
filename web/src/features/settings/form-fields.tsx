// Controlled field building blocks for the settings forms (react-hook-form `Controller` + shadcn `Field`). Each one
// shows its own error from the form state (client problems and server errors placed with `setError`).
import * as React from "react"
import { Controller, get, useFormState, type Control, type FieldPath, type FieldValues } from "react-hook-form"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface BaseFieldProps<T extends FieldValues> {
  control: Control<T>
  name: FieldPath<T>
  label: React.ReactNode
  /** Visually hide the label (table-like rows); it stays the accessible name. */
  hideLabel?: boolean
  description?: React.ReactNode
  disabled?: boolean
  className?: string
}

const idOf = (name: string) => `field-${name.replace(/[^A-Za-z0-9_-]/g, "-")}`

interface TextFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  placeholder?: string
  multiline?: boolean
  rows?: number
  type?: "text" | "email" | "url" | "tel"
  /** Extra classes for the input itself (e.g. `font-mono`). */
  inputClassName?: string
}

/** A text input (or textarea) bound to a string field. */
export function TextField<T extends FieldValues>({
  control, name, label, hideLabel, description, disabled, className, placeholder, multiline, rows = 3, type = "text", inputClassName,
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const id = idOf(name)
        const common = {
          id,
          name: field.name,
          value: typeof field.value === "string" ? field.value : "",
          onChange: field.onChange,
          onBlur: field.onBlur,
          placeholder,
          disabled,
          "aria-invalid": fieldState.invalid || undefined,
          className: inputClassName,
        }
        return (
          <Field data-invalid={fieldState.invalid || undefined} data-disabled={disabled || undefined} className={className}>
            <FieldLabel htmlFor={id} className={cn(hideLabel && "sr-only")}>{label}</FieldLabel>
            {multiline ? <Textarea ref={field.ref} rows={rows} {...common} /> : <Input ref={field.ref} type={type} {...common} />}
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )
      }}
    />
  )
}

interface SelectFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  options: Array<{ value: string; label: string }>
}

/** A native select bound to a string field. A current value missing from `options` is still offered. */
export function SelectField<T extends FieldValues>({ control, name, label, hideLabel, description, disabled, className, options }: SelectFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const id = idOf(name)
        const value = typeof field.value === "string" ? field.value : ""
        const all = value && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options
        return (
          <Field data-invalid={fieldState.invalid || undefined} data-disabled={disabled || undefined} className={className}>
            <FieldLabel htmlFor={id} className={cn(hideLabel && "sr-only")}>{label}</FieldLabel>
            <NativeSelect
              ref={field.ref}
              id={id}
              name={field.name}
              value={value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              disabled={disabled}
              aria-invalid={fieldState.invalid || undefined}
              className="w-full"
            >
              {all.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>
              ))}
            </NativeSelect>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )
      }}
    />
  )
}

/** The error set on a list as a whole (`<name>.root`, e.g. "must contain a default contact"), if any. */
export function ListError<T extends FieldValues>({ control, name }: { control: Control<T>; name: string }) {
  const { errors } = useFormState({ control })
  const error = get(errors, `${name}.root`) as { message?: string } | undefined
  return error?.message ? <FieldError errors={[error]} /> : null
}
