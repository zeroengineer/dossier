import { PlusIcon, Trash2Icon } from "lucide-react"
import { Controller, useFieldArray, type Control, type FieldArrayPath, type FieldPath } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ListError, SelectField, TextField } from "../form-fields"
import type { BrandFormValues } from "./brand-form"

export interface RowColumn {
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

interface RowsEditorProps {
  control: Control<BrandFormValues>
  /** The field array (`registrations.rows`, `contacts`, ...). */
  name: FieldArrayPath<BrandFormValues>
  columns: RowColumn[]
  /** A blank row. */
  blank: Record<string, string>
  /** Accessible name of row `i` ("registration 1"). */
  rowLabel: (i: number) => string
  addLabel: string
  /** Read-only (an inherited list that is not overridden). */
  disabled?: boolean
  empty?: string
  /** Grid columns per row (default: the number of columns, at most 4). */
  gridColumns?: number
}

/** Repeatable rows of fields with Add / Remove; blank rows are dropped when saving. */
export function RowsEditor({ control, name, columns, blank, rowLabel, addLabel, disabled, empty = "No rows yet.", gridColumns }: RowsEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name })
  const grid = GRID[Math.min(gridColumns ?? columns.length, 4)] ?? GRID[4]
  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      {fields.map((f, i) => (
        <div key={f.id} role="group" aria-label={rowLabel(i)} className="flex items-start gap-2 rounded-lg border bg-card p-3">
          <div className={cn("grid flex-1 gap-3", grid)}>
            {columns.map((c) => {
              const fieldName = `${name}.${i}.${c.key}` as FieldPath<BrandFormValues>
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
          <Button type="button" variant="outline" size="sm" onClick={() => append(blank as never)}>
            <PlusIcon data-icon="inline-start" />
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The "override the inherited list" switch of an inheriting brand's list (`<list>.override`). */
export function OverrideSwitch({ control, name, parentId }: { control: Control<BrandFormValues>; name: FieldPath<BrandFormValues>; parentId: string }) {
  const id = `override-${name.replace(/\W/g, "-")}`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <Switch id={id} checked={field.value === true} onCheckedChange={field.onChange} />
          <FieldContent>
            <FieldLabel htmlFor={id}>Override the inherited list</FieldLabel>
            <FieldDescription>
              {field.value === true
                ? "This brand saves its own list."
                : `Off: the list of ${parentId} is used (shown read-only). Turn on to edit a copy.`}
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
    />
  )
}
