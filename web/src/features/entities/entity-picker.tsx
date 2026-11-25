import * as React from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useEntities } from "@/api/entities"
import type { EntitySummary } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { useDebounced } from "@/hooks/use-debounced"
import { cn } from "@/lib/utils"
import { kindLabel } from "./labels"

const SEARCH_LIMIT = 20
const DEBOUNCE_MS = 200

interface EntityPickerProps {
  id?: string
  value: EntitySummary | null
  onChange: (entity: EntitySummary | null) => void
  /** An entity that cannot be picked (the entity being related). */
  excludeId?: number
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
}

/** Combobox over the master list: searches names and aliases on the server (`/api/entities?q=`) as you type. */
export function EntityPicker({ id, value, onChange, excludeId, invalid, disabled, placeholder = "Choose an entity…" }: EntityPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const q = useDebounced(search.trim(), DEBOUNCE_MS)
  const { data, isFetching, isError } = useEntities({ q: q || undefined, limit: SEARCH_LIMIT }, { enabled: open })
  const options = (data?.entities ?? []).filter((e) => e.id !== excludeId)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="w-full justify-between font-normal aria-invalid:border-destructive"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? `${value.name} (${kindLabel(value.kind)})` : placeholder}
          </span>
          <ChevronsUpDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false} label="Search entities">
          <CommandInput value={search} onValueChange={setSearch} placeholder="Search names and aliases…" />
          <CommandList>
            {isFetching && !data ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner />
                Searching…
              </div>
            ) : (
              <CommandEmpty>{isError ? "Could not search entities." : "No entities found."}</CommandEmpty>
            )}
            {options.length ? (
              <CommandGroup>
                {options.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={String(e.id)}
                    onSelect={() => {
                      onChange(e)
                      setOpen(false)
                      setSearch("")
                    }}
                  >
                    <CheckIcon className={cn(value?.id === e.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{e.name}</span>
                      {e.matched ? <span className="truncate text-xs text-muted-foreground">matched {e.matched}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{kindLabel(e.kind)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
