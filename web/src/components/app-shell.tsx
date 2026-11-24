import { Suspense } from "react"
import { SearchIcon } from "lucide-react"
import { Outlet } from "react-router"
import { AppSidebar } from "@/components/app-sidebar"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { CommandPaletteProvider, modKey, useCommandPalette } from "@/components/command-palette"
import { PageSkeleton } from "@/components/page-skeleton"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"

function PaletteButton() {
  const { setOpen } = useCommandPalette()
  return (
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label="Open command palette" className="text-muted-foreground">
      <SearchIcon data-icon="inline-start" />
      <span className="hidden sm:inline">Search or jump to…</span>
      <Kbd>{modKey()} K</Kbd>
    </Button>
  )
}

/** Sidebar + sticky header (trigger, breadcrumbs, ⌘K) around the routed page. */
export function AppShell() {
  return (
    <CommandPaletteProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <div className="min-w-0 flex-1">
              <Breadcrumbs />
            </div>
            <PaletteButton />
          </header>
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" />
    </CommandPaletteProvider>
  )
}
