import * as React from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useParty, usePartyOptions } from "@/api/documents"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { DEBOUNCE_MS, useDebounced } from "@/hooks/use-debounced"
import { cn } from "@/lib/utils"

interface PickerTriggerProps extends React.ComponentProps<typeof Button> {
  label: string | undefined
  placeholder: string
  invalid?: boolean
}

function PickerTrigger({ label, placeholder, invalid, className, ...props }: PickerTriggerProps) {
  return (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-invalid={invalid || undefined}
      className={cn("w-full justify-between font-normal", className)}
      {...props}
    >
      <span className={cn("truncate", label === undefined && "text-muted-foreground")}>{label ?? placeholder}</span>
      <ChevronsUpDownIcon data-icon="inline-end" className="text-muted-foreground" />
    </Button>
  )
}

interface TypeComboboxProps {
  id?: string
  value: string
  onChange: (type: string) => void
  /** Known document types (`meta.documentTypes`). A typed value that is not in the list can still be used. */
  types: string[]
  invalid?: boolean
  disabled?: boolean
}

/** Document type: a searchable list of the workspace's types, plus "Use …" for a type that is not listed yet. */
export function TypeCombobox({ id, value, onChange, types, invalid, disabled }: TypeComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const typed = query.trim()
  const needle = typed.toLowerCase()
  const matches = types.filter((t) => t.toLowerCase().includes(needle))
  const exact = types.some((t) => t.toLowerCase() === needle)

  function choose(type: string) {
    onChange(type)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger id={id} label={value || undefined} placeholder="Choose a type…" invalid={invalid} disabled={disabled} aria-expanded={open} />
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search types…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No types found.</CommandEmpty>
            {matches.length > 0 ? (
              <CommandGroup>
                {matches.map((t) => (
                  <CommandItem key={t} value={t} onSelect={() => choose(t)} data-checked={t === value}>
                    <CheckIcon className={cn(t !== value && "invisible")} />
                    {t}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {typed !== "" && !exact ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value={`use:${typed}`} onSelect={() => choose(typed)}>
                    Use “{typed}”
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface PartyComboboxProps {
  id?: string
  /** Entity id as a string, `""` for none. */
  value: string
  onChange: (partyId: string) => void
  invalid?: boolean
  disabled?: boolean
}

/** Party: a searchable list over `/api/entities` (debounced, names and aliases), like the documents party filter. */
export function PartyCombobox({ id, value, onChange, invalid, disabled }: PartyComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const q = useDebounced(query.trim(), DEBOUNCE_MS)
  const options = usePartyOptions(q, open)
  const selectedId = value === "" ? undefined : Number(value)
  const selected = useParty(selectedId)
  const [picked, setPicked] = React.useState<{ id: number; name: string } | null>(null)
  const label = selectedId === undefined
    ? undefined
    : (picked?.id === selectedId ? picked.name : (selected.data?.name ?? `#${selectedId}`))

  function choose(entity: { id: number; name: string } | null) {
    setPicked(entity)
    onChange(entity ? String(entity.id) : "")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger id={id} label={label} placeholder="No party" invalid={invalid} disabled={disabled} aria-expanded={open} />
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search parties…" value={query} onValueChange={setQuery} />
          <CommandList>
            {options.isFetching && !options.data ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : (
              <CommandEmpty>{options.isError ? "Could not load parties." : "No parties found."}</CommandEmpty>
            )}
            {options.data && options.data.length > 0 ? (
              <CommandGroup>
                {options.data.map((entity) => {
                  const isSelected = entity.id === selectedId
                  return (
                    <CommandItem key={entity.id} value={String(entity.id)} onSelect={() => choose(entity)} data-checked={isSelected}>
                      <CheckIcon className={cn(!isSelected && "invisible")} />
                      <span className="truncate">{entity.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{entity.kind.replace(/_/g, " ")}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {selectedId !== undefined ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="clear" onSelect={() => choose(null)} className="justify-center text-center">
                    No party
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
