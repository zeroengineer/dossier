import * as React from "react"
import { useNavigate } from "react-router"
import { defaultFilter } from "cmdk"
import { FilePlus2Icon, FileTextIcon, SearchIcon } from "lucide-react"
import { useSearch } from "@/api/search"
import { useTemplates } from "@/api/templates"
import type { SearchEntity, SearchHit } from "@/api/types"
import { StatusBadge } from "@/components/status-badge"
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command"
import { Spinner } from "@/components/ui/spinner"
import { kindIcon } from "@/features/entities/kind-icon"
import { kindLabel } from "@/features/entities/labels"
import { Highlighted } from "@/features/search/highlight"
import { documentPath, entityPath, generatePath, searchPath } from "@/features/search/paths"
import { useDebounced } from "@/hooks/use-debounced"
import { NAV_GROUPS, SEARCH_ITEM, SETTINGS_ITEMS, type NavItem } from "@/lib/nav"

/** Live results wait this long after the last keystroke before calling `/api/search`. */
export const SEARCH_DEBOUNCE_MS = 200
/** Documents and entities shown per query. */
export const SEARCH_LIMIT = 8

/** Item values of server results start with this; the server already matched them, so cmdk never filters them out. */
const LIVE = "live:"
const docValue = (id: string) => `${LIVE}doc:${id}`
const entityValue = (id: number) => `${LIVE}entity:${id}`
const SEARCH_VALUE = `${LIVE}search`

const paletteFilter = (value: string, search: string, keywords?: string[]) =>
  value.startsWith(LIVE) ? 1 : defaultFilter(value, search, keywords)

interface CommandPaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const CommandPaletteContext = React.createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette() {
  const ctx = React.useContext(CommandPaletteContext)
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider")
  return ctx
}

/** Holds the palette's open state and binds ⌘K / Ctrl+K anywhere in the app. */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const toggle = React.useCallback(() => setOpen((o) => !o), [])

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [toggle])

  const value = React.useMemo(() => ({ open, setOpen, toggle }), [open, toggle])
  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette />
    </CommandPaletteContext.Provider>
  )
}

/** `⌘` on Apple platforms, `Ctrl` elsewhere. */
export function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl"
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"
}

function PaletteItem({ item, onSelect, group }: { item: NavItem; onSelect: (to: string) => void; group: string }) {
  const Icon = item.icon
  return (
    <CommandItem value={`${group} ${item.title}`} keywords={item.keywords} onSelect={() => onSelect(item.to)}>
      <Icon />
      <span>{item.title}</span>
    </CommandItem>
  )
}

function DocumentResult({ hit, disabled, onSelect }: { hit: SearchHit; disabled: boolean; onSelect: (to: string) => void }) {
  const d = hit.document
  return (
    <CommandItem value={docValue(d.id)} disabled={disabled} onSelect={() => onSelect(documentPath(d.id))}>
      <FileTextIcon />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 gap-2">
          {d.docNumber ? <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{d.docNumber}</span> : null}
          <span className="truncate">{d.title}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {hit.snippet ? <Highlighted snippet={hit.snippet} /> : [d.type, d.party?.name].filter(Boolean).join(" · ")}
        </span>
      </div>
      <StatusBadge status={d.status} className="shrink-0" />
    </CommandItem>
  )
}

function EntityResult({ entity, disabled, onSelect }: { entity: SearchEntity; disabled: boolean; onSelect: (to: string) => void }) {
  const Icon = kindIcon(entity.kind)
  const kind = kindLabel(entity.kind)
  return (
    <CommandItem value={entityValue(entity.id)} disabled={disabled} onSelect={() => onSelect(entityPath(entity.id))}>
      <Icon />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{entity.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {entity.matched ? `${kind} · alias “${entity.matched}”` : kind}
        </span>
      </div>
    </CommandItem>
  )
}

/**
 * The palette's content, mounted only while the dialog is open (so templates and search load on first use).
 * Typing runs a debounced `/api/search?q=&limit=8`; its Documents and Entities groups come first, then "Search for …"
 * (Enter opens the search page when there are no results), Navigate, Create (one item per template) and Settings.
 */
function PaletteBody({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [input, setInput] = React.useState("")
  const [selected, setSelected] = React.useState("")
  const query = input.trim()
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS)
  const search = useSearch(debounced, { limit: SEARCH_LIMIT })
  const templates = useTemplates()

  // Results stay on screen while the next query loads; hide them once the input is cleared.
  const results = query !== "" && debounced !== "" ? search.data : undefined
  const hits = results?.hits ?? []
  const entities = results?.entities ?? []
  // The shown results belong to an earlier query (debounce pending, or the next request in flight): they are dimmed
  // and disabled, and "Search for …" is selected, so Enter never opens a result of the previous query.
  const stale = query !== "" && (debounced !== query || search.isPlaceholderData)

  const applied = React.useRef<unknown>(null)
  React.useEffect(() => {
    if (!stale) return
    applied.current = null
    setSelected(SEARCH_VALUE)
  }, [stale, query])

  // Fresh results: select the first one so Enter opens it, unless the user already moved to another item.
  const first = hits[0] ? docValue(hits[0].document.id) : entities[0] ? entityValue(entities[0].id) : null
  const live = new Set([...hits.map((h) => docValue(h.document.id)), ...entities.map((e) => entityValue(e.id))])
  React.useEffect(() => {
    if (stale || !first || applied.current === search.data) return
    applied.current = search.data
    const replaceable = selected === "" || selected === SEARCH_VALUE || (selected.startsWith(LIVE) && !live.has(selected))
    if (replaceable) setSelected(first)
  })

  return (
    <Command filter={paletteFilter} value={selected} onValueChange={setSelected}>
      <CommandInput placeholder="Search documents and entities, or jump to a page…" value={input} onValueChange={setInput} />
      {query !== "" && (search.isFetching || debounced !== query) ? (
        <div role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Spinner />
          Searching…
        </div>
      ) : null}
      {query !== "" && search.isError && !search.isFetching ? (
        <div role="alert" className="px-3 py-2 text-xs text-muted-foreground">
          Search failed. Press Enter on “Search for” to try the search page.
        </div>
      ) : null}
      <CommandList>
        <CommandEmpty>No matching pages.</CommandEmpty>
        {hits.length ? (
          <CommandGroup heading="Documents">
            {hits.map((hit) => (
              <DocumentResult key={hit.document.id} hit={hit} disabled={stale} onSelect={onNavigate} />
            ))}
          </CommandGroup>
        ) : null}
        {entities.length ? (
          <CommandGroup heading="Entities">
            {entities.map((entity) => (
              <EntityResult key={entity.id} entity={entity} disabled={stale} onSelect={onNavigate} />
            ))}
          </CommandGroup>
        ) : null}
        {query !== "" ? (
          <CommandGroup heading="Search">
            <CommandItem value={SEARCH_VALUE} onSelect={() => onNavigate(searchPath(query))}>
              <SearchIcon />
              <span className="truncate">Search for “{query}”</span>
            </CommandItem>
          </CommandGroup>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
            <PaletteItem key={item.to} item={item} group="navigate" onSelect={onNavigate} />
          ))}
          <PaletteItem item={SEARCH_ITEM} group="navigate" onSelect={onNavigate} />
        </CommandGroup>
        {templates.data?.templates.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Create">
              {templates.data.templates.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`create ${t.title} ${t.id}`}
                  keywords={["generate", "new", t.type, t.category]}
                  onSelect={() => onNavigate(generatePath(t.id))}
                >
                  <FilePlus2Icon />
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t.category}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Settings">
          {SETTINGS_ITEMS.map((item) => (
            <PaletteItem key={item.to} item={item} group="settings" onSelect={onNavigate} />
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** ⌘K palette: live document and entity search plus navigation, templates and settings. */
function CommandPalette() {
  const { open, setOpen } = useCommandPalette()
  const navigate = useNavigate()
  const go = React.useCallback(
    (to: string) => {
      setOpen(false)
      navigate(to)
    },
    [navigate, setOpen],
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search or jump to a page">
      {open ? <PaletteBody onNavigate={go} /> : null}
    </CommandDialog>
  )
}
