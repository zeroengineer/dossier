// Repeatable rows for the settings forms (brands, numbering, ...), generic over the form's values.
import { PlusIcon, Trash2Icon } from "lucide-react"
import {
  Controller, useFieldArray, type Control, type FieldArray, type FieldArrayPath, type FieldPath, type FieldValues,
} from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ListError, SelectField, TextField } from "./form-fields"

export interface RowColumn {
  /** The row's field (`label`, `value`, ...). */
  key: string
  label: string
  placeholder?: string
  multiline?: boolean
  /** Renders a select with these options instead of a text input. */
  options?: Array<{ value: string; label: string }>
  /** Wider column (spans two grid columns from `sm`). */
  wide?: boolean
}

const GRID: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
}

interface RowsEditorProps<T extends FieldValues, N extends FieldArrayPath<T>> {
  control: Control<T>
  /** The field array (`registrations.rows`, `contacts`, `series`, ...). */
  name: N
  columns: RowColumn[]
  /** A blank row (what "Add" appends). */
  blank: FieldArray<T, N>
  /** Accessible name of row `i` ("registration 1"); also suffixes each field's label for screen readers. */
  rowLabel: (i: number) => string
  addLabel: string
  /** Read-only (e.g. an inherited list that is not overridden): no Add or Remove, disabled fields. */
  disabled?: boolean
  empty?: string
  /** Grid columns per row (default: the number of columns, at most 4). */
  gridColumns?: number
}

/**
 * Rows of fields with Add / Remove, one bordered group per row. Field errors show under each field; an error set on
 * `<name>.root` shows under the rows.
 */
export function RowsEditor<T extends FieldValues, N extends FieldArrayPath<T>>({
  control, name, columns, blank, rowLabel, addLabel, disabled, empty = "No rows yet.", gridColumns,
}: RowsEditorProps<T, N>) {
  const { fields, append, remove } = useFieldArray({ control, name })
  const grid = GRID[Math.min(gridColumns ?? columns.length, 4)] ?? GRID[4]
  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      {fields.map((f, i) => (
        <div key={f.id} role="group" aria-label={rowLabel(i)} className="flex items-start gap-2 rounded-lg border bg-card p-3">
          <div className={cn("grid flex-1 gap-3", grid)}>
            {columns.map((c) => {
              const fieldName = `${name}.${i}.${c.key}` as FieldPath<T>
              const label = (
                <>
                  {c.label}
                  <span className="sr-only"> ({rowLabel(i)})</span>
                </>
              )
              const cls = c.wide ? "sm:col-span-2" : undefined
              return c.options ? (
                <SelectField key={c.key} control={control} name={fieldName} label={label} options={c.options} disabled={disabled} className={cls} />
              ) : (
                <TextField
                  key={c.key}
                  control={control}
                  name={fieldName}
                  label={label}
                  placeholder={c.placeholder}
                  multiline={c.multiline}
                  disabled={disabled}
                  className={cls}
                />
              )
            })}
          </div>
          {disabled ? null : (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${rowLabel(i)}`} onClick={() => remove(i)}>
              <Trash2Icon />
            </Button>
          )}
        </div>
      ))}
      <ListError control={control} name={name} />
      {disabled ? null : (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => append(blank)}>
            <PlusIcon data-icon="inline-start" />
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

interface OverrideSwitchProps<T extends FieldValues> {
  control: Control<T>
  /** A boolean field: on = this form saves its own list. */
  name: FieldPath<T>
  /** Where the list comes from while the switch is off (e.g. the parent brand's id). */
  source: string
  label?: string
}

/** "Override the inherited list" switch for a list that is otherwise taken from `source`. */
export function OverrideSwitch<T extends FieldValues>({ control, name, source, label = "Override the inherited list" }: OverrideSwitchProps<T>) {
  const id = `override-${name.replace(/\W/g, "-")}`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <Switch id={id} checked={field.value === true} onCheckedChange={field.onChange} />
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <FieldDescription>
              {field.value === true ? "This list is saved here." : `Off: the list of ${source} is used (shown read-only). Turn on to edit a copy.`}
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
    />
  )
}
