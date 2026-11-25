import * as React from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { type Control, Controller, type FieldError as RhfFieldError, useFieldArray, useFormState } from "react-hook-form"
import { useEntityOptions } from "@/api/generate"
import type { TemplateField, TemplateMetaField } from "@/api/types"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { blankRow, fieldKind } from "./schema"
import { type FormValues, getPath } from "./to-input"

/** Radix Select items cannot have an empty value: this one stands for "no value" (the template's default applies). */
const UNSET = "__unset__"

const inputId = (name: string) => `field-${name.replace(/\./g, "-")}`

/** The message of a field's error, also for list fields (react-hook-form puts array-level errors on `root`). */
function messageOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const e = error as Partial<RhfFieldError> & { root?: RhfFieldError }
  return e.message ?? e.root?.message
}

/**
 * A default that is itself a source (`today`, `brand.tax.defaultMode`, `computed:…`; src/services/fields.js
 * isSourceDefault) resolves on the server; only literal defaults can be shown as a hint.
 */
const SOURCE_DEFAULT = /^(today$|brand$|brand\.|const:|computed:)/

/** A short text for a literal template default that applies when the field is left blank (placeholder / option). */
function defaultHint(meta: TemplateMetaField | undefined): string {
  const d = meta?.default
  if (typeof d === "string") return SOURCE_DEFAULT.test(d) ? "" : d
  if (typeof d === "number") return String(d)
  return ""
}

interface FieldProps {
  field: TemplateField
  control: Control<FormValues>
  meta: TemplateMetaField | undefined
}

/** One input of the generate form, chosen by the field's type (see `fieldKind`). */
export function TemplateFieldInput({ field, control, meta }: FieldProps) {
  const kind = fieldKind(field)
  if (kind === "rows") return <RowsField field={field} control={control} />
  const id = inputId(field.name)
  const hint = defaultHint(meta)
  return (
    <Controller
      name={field.name}
      control={control}
      render={({ field: rhf, fieldState }) => {
        const invalid = fieldState.invalid
        const value = typeof rhf.value === "string" ? rhf.value : ""
        const common = { id, name: rhf.name, onBlur: rhf.onBlur, ref: rhf.ref, "aria-invalid": invalid || undefined }
        let input: React.ReactNode
        switch (kind) {
          case "boolean":
            return (
              <Field orientation="horizontal" data-invalid={invalid || undefined}>
                <FieldContent>
                  <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                  {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
                </FieldContent>
                <Switch
                  {...common}
                  checked={rhf.value === true}
                  onCheckedChange={(checked) => rhf.onChange(checked)}
                />
              </Field>
            )
          case "entity":
            input = (
              <EntityCombobox
                id={id}
                kind={field.entityKind ?? ""}
                value={value}
                invalid={invalid}
                onChange={rhf.onChange}
                onBlur={rhf.onBlur}
              />
            )
            break
          case "enum":
            input = (
              <Select
                name={rhf.name}
                value={value === "" ? UNSET : value}
                onValueChange={(v) => rhf.onChange(v === UNSET ? "" : v)}
              >
                <SelectTrigger id={id} ref={rhf.ref} onBlur={rhf.onBlur} aria-invalid={invalid || undefined} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>{hint ? `Default (${hint})` : "—"}</SelectItem>
                  {(field.choices ?? []).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
            break
          case "date":
            input = <Input {...common} type="date" value={value} onChange={rhf.onChange} className="w-fit" />
            break
          case "money":
          case "number":
            input = (
              <Input
                {...common}
                inputMode="decimal"
                autoComplete="off"
                value={value}
                placeholder={hint}
                onChange={rhf.onChange}
                className="max-w-56 tabular-nums"
              />
            )
            break
          case "text":
          case "lines":
            input = (
              <Textarea {...common} rows={kind === "text" ? 4 : 3} value={value} placeholder={hint} onChange={rhf.onChange} />
            )
            break
          case "structured":
            input = (
              <Textarea
                {...common}
                rows={4}
                value={value}
                placeholder={field.type === "array" ? "One entry per line, or JSON" : "JSON object"}
                onChange={rhf.onChange}
                className="font-mono text-xs"
                spellCheck={false}
              />
            )
            break
          default:
            input = <Input {...common} value={value} placeholder={hint} onChange={rhf.onChange} />
        }
        return (
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor={id}>
              {field.label}
              {field.required ? (
                <span aria-hidden className="text-primary">
                  *
                </span>
              ) : null}
            </FieldLabel>
            {input}
            {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
            <FieldError>{fieldState.error?.message}</FieldError>
          </Field>
        )
      }}
    />
  )
}

interface EntityComboboxProps {
  id: string
  kind: string
  value: string
  invalid: boolean
  onChange: (value: string) => void
  onBlur: () => void
}

/** Pick an entity of `kind` by name; the server resolves the name (or an alias) to the entity. */
function EntityCombobox({ id, kind, value, invalid, onChange, onBlur }: EntityComboboxProps) {
  const { data, isPending, isError } = useEntityOptions(kind)
  const names = React.useMemo(() => {
    const list = (data?.entities ?? []).map((e) => e.name)
    return value && !list.includes(value) ? [value, ...list] : list
  }, [data, value])
  return (
    <Combobox items={names} value={value || null} onValueChange={(v) => onChange(v ?? "")}>
      <ComboboxInput
        id={id}
        placeholder={isPending ? "Loading…" : `Pick a ${kind}`}
        aria-invalid={invalid || undefined}
        onBlur={onBlur}
        showClear={value !== ""}
        className="w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty>{isError ? `Could not load ${kind} entities.` : `No ${kind} found.`}</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name}>
              {name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/** A list field with row columns: one row of inputs per entry; rows left blank are dropped on submit. */
function RowsField({ field, control }: Omit<FieldProps, "meta">) {
  // The form's values are untyped by path; a list field's value is an array of rows of strings.
  const rowsControl = control as unknown as Control<Record<string, Record<string, string>[]>>
  const { fields: rows, append, remove } = useFieldArray({ control: rowsControl, name: field.name })
  const { errors } = useFormState({ control, name: field.name })
  const columns = Object.entries(field.item ?? {})
  const error = messageOf(getPath(errors, field.name))
  const labelId = `${inputId(field.name)}-label`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldTitle id={labelId}>
        {field.label}
        {field.required ? (
          <span aria-hidden className="text-primary">
            *
          </span>
        ) : null}
      </FieldTitle>
      <div className="rounded-lg border">
        <Table aria-labelledby={labelId}>
          <TableHeader>
            <TableRow>
              {columns.map(([key, type]) => (
                <TableHead key={key} className={type === "money" || type === "number" ? "text-right" : undefined}>
                  {key} <span className="font-normal text-muted-foreground">{type}</span>
                </TableHead>
              ))}
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={row.id}>
                {columns.map(([key, type]) => (
                  <TableCell key={key} className="align-top">
                    <RowCell name={`${field.name}.${i}.${key}`} type={type} label={`${field.label} row ${i + 1} ${key}`} control={control} />
                  </TableCell>
                ))}
                <TableCell className="align-top">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${field.label} row ${i + 1}`}
                    onClick={() => remove(i)}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => append(blankRow(field))}>
          <PlusIcon data-icon="inline-start" />
          Add row
        </Button>
      </div>
      {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

interface RowCellProps {
  name: string
  type: string
  label: string
  control: Control<FormValues>
}

/** One cell of a list row, by the column's item type. */
function RowCell({ name, type, label, control }: RowCellProps) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field: rhf, fieldState }) => {
        const value = typeof rhf.value === "string" ? rhf.value : ""
        const common = {
          name: rhf.name,
          onBlur: rhf.onBlur,
          ref: rhf.ref,
          "aria-label": label,
          "aria-invalid": fieldState.invalid || undefined,
        }
        if (type === "boolean") {
          return (
            <Select value={value === "" ? UNSET : value} onValueChange={(v) => rhf.onChange(v === UNSET ? "" : v)}>
              <SelectTrigger ref={rhf.ref} aria-label={label} onBlur={rhf.onBlur} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Default</SelectItem>
                <SelectItem value="true">Yes</SelectItem>
                <SelectItem value="false">No</SelectItem>
              </SelectContent>
            </Select>
          )
        }
        if (type === "text") {
          // One line high like the inputs beside it; it grows with its text.
          return <Textarea {...common} rows={1} value={value} onChange={rhf.onChange} className="min-h-8 min-w-48 py-1" />
        }
        if (type === "date") return <Input {...common} type="date" value={value} onChange={rhf.onChange} />
        const numeric = type === "money" || type === "number"
        return (
          <Input
            {...common}
            value={value}
            onChange={rhf.onChange}
            autoComplete="off"
            inputMode={numeric ? "decimal" : undefined}
            className={numeric ? "min-w-28 text-right tabular-nums" : "min-w-28"}
          />
        )
      }}
    />
  )
}
