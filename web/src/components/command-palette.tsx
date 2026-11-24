import * as React from "react"
import { useNavigate } from "react-router"
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command"
import { NAV_GROUPS, SEARCH_ITEM, SETTINGS_ITEMS, type NavItem } from "@/lib/nav"

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

/** Navigation-only command palette (live document and entity results arrive with the search feature). */
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
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a page">
      <Command>
      <CommandInput placeholder="Type a page name…" />
      <CommandList>
        <CommandEmpty>No matching pages.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
            <PaletteItem key={item.to} item={item} group="navigate" onSelect={go} />
          ))}
          <PaletteItem item={SEARCH_ITEM} group="navigate" onSelect={go} />
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          {SETTINGS_ITEMS.map((item) => (
            <PaletteItem key={item.to} item={item} group="settings" onSelect={go} />
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
