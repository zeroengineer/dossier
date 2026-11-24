import * as React from "react"
import { CheckIcon, PlusCircleIcon } from "lucide-react"
import { useParty, usePartyOptions } from "@/api/documents"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { DEBOUNCE_MS, useDebounced } from "@/hooks/use-debounced"
import { cn } from "@/lib/utils"

interface PartyFilterProps {
  value: number | undefined
  onChange: (partyId: number | undefined) => void
}

/** Party filter: a searchable list over `/api/entities` (debounced, server-side match on names and aliases). */
export function PartyFilter({ value, onChange }: PartyFilterProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const q = useDebounced(query.trim(), DEBOUNCE_MS)
  const options = usePartyOptions(q, open)
  const selected = useParty(value)
  const selectedName = value === undefined ? undefined : (selected.data?.name ?? `#${value}`)

  function choose(id: number | undefined) {
    onChange(id === value ? undefined : id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <PlusCircleIcon data-icon="inline-start" />
          Party
          {selectedName !== undefined ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge variant="secondary" className="max-w-40 truncate">
                {selectedName}
              </Badge>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
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
                  const isSelected = entity.id === value
                  return (
                    <CommandItem key={entity.id} value={String(entity.id)} onSelect={() => choose(entity.id)} data-checked={isSelected}>
                      <CheckIcon className={cn(!isSelected && "invisible")} />
                      <span className="truncate">{entity.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{entity.kind.replace(/_/g, " ")}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {value !== undefined ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="clear" onSelect={() => choose(undefined)} className="justify-center text-center">
                    Clear filter
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
