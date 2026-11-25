import { Suspense, useEffect, useState, type MouseEvent } from "react"
import { SearchIcon } from "lucide-react"
import { Outlet, ScrollRestoration } from "react-router"
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
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-muted-foreground">
      <SearchIcon data-icon="inline-start" />
      <span className="sr-only sm:not-sr-only">Search or jump to…</span>
      <Kbd>{modKey()} K</Kbd>
    </Button>
  )
}

const MAIN_ID = "main-content"

/**
 * Moves focus to the page content without touching the URL: following `#main-content` would go through the router,
 * replace the location hash (which some nav items match on) and add a history entry. The href stays as a fallback.
 */
function skipToMain(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.getElementById(MAIN_ID)
  if (!main) return
  event.preventDefault()
  main.focus()
  main.scrollIntoView({ block: "start" })
}

/** True once the window has scrolled, so the floating header can lift off the content under it. */
function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [threshold])
  return scrolled
}

/**
 * Floating sidebar + floating sticky header (trigger, breadcrumbs, ⌘K) around the routed page. The header and the page
 * share the sidebar's 0.5rem inset from the window edges, so their top and bottom edges line up with the sidebar's.
 */
export function AppShell() {
  const scrolled = useScrolled()
  return (
    <CommandPaletteProvider>
      <a
        href={`#${MAIN_ID}`}
        onClick={skipToMain}
        className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Skip to main content
      </a>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header
            data-slot="app-header"
            data-scrolled={scrolled || undefined}
            className="group/header sticky top-0 z-20 shrink-0 px-3 pt-3 md:pt-2 md:pr-2 md:pl-3"
          >
            <div className="flex h-12 items-center gap-2 rounded-xl border bg-background/70 px-2 backdrop-blur-md transition-shadow duration-200 ease-out group-data-scrolled/header:bg-background/80 group-data-scrolled/header:shadow-md">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
              <div className="min-w-0 flex-1">
                <Breadcrumbs />
              </div>
              <PaletteButton />
            </div>
          </header>
          <div
            id={MAIN_ID}
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col gap-6 px-3 pt-6 pb-6 outline-none md:ml-3 md:pr-2 md:pb-2 md:pl-0"
          >
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" />
      {/* A new page starts at the top (or at its #anchor); back and forward restore where you were. */}
      <ScrollRestoration />
    </CommandPaletteProvider>
  )
}
