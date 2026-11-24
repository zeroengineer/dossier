import * as React from "react"
import { PlusIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { addAlias } from "./entity-form"

interface AliasInputProps {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  /** Aliases that cannot be removed (the server only ever adds aliases); shown without a remove button. */
  locked?: string[]
  invalid?: boolean
  disabled?: boolean
  "aria-describedby"?: string
}

/** Tag input for aliases: Enter, comma or Add commits the typed alias; Backspace in an empty box removes the last new one. */
export function AliasInput({ id, value, onChange, locked = [], invalid, disabled, ...aria }: AliasInputProps) {
  const [draft, setDraft] = React.useState("")

  function commit(text = draft) {
    const parts = text.split(",")
    let next = value
    for (const p of parts) next = addAlias(next, p)
    if (next !== value) onChange(next)
    setDraft("")
  }

  function remove(alias: string) {
    onChange(value.filter((a) => a !== alias))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      commit()
    } else if (e.key === "Backspace" && draft === "") {
      const last = [...value].reverse().find((a) => !locked.includes(a))
      if (last !== undefined) remove(last)
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text")
    if (!text.includes(",")) return
    e.preventDefault()
    commit(draft + text)
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Alias list">
          {value.map((alias) => (
            <li key={alias}>
              <Badge variant="secondary" className="max-w-full gap-1 pr-1">
                <span className="truncate">{alias}</span>
                {locked.includes(alias) ? null : (
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => remove(alias)}
                    disabled={disabled}
                    aria-label={`Remove alias ${alias}`}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <InputGroup>
        <InputGroupInput
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit()}
          placeholder="Type an alias and press Enter"
          aria-invalid={invalid || undefined}
          disabled={disabled}
          {...aria}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs" onClick={() => commit()} disabled={disabled || draft.trim() === ""} aria-label="Add alias">
            <PlusIcon data-icon="inline-start" />
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
