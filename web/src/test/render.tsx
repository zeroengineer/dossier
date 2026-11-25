import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { routes } from "@/router"

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

function Providers({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}

/**
 * Render the whole app (shell + lazy routes) at `path` with a fresh query client and memory router. Use it for tests
 * of the shell itself or of moving between pages; a single page or feature is faster and steadier with `renderRoute`.
 */
export function renderApp(path = "/") {
  const queryClient = createTestQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  const utils = render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { ...utils, user, router, queryClient }
}

export interface RenderRouteOptions {
  /** The route pattern `element` is mounted at, for pages that read params (`/documents/:id`). Default `*`. */
  route?: string
  /** Further routes the test needs besides the catch-all. */
  routes?: RouteObject[]
  /** Child routes rendered in `element`'s `<Outlet />` (for layouts such as the app shell). */
  children?: RouteObject[]
  /** Mount a toaster (default true); false when `element` brings its own, as the app shell does. */
  toaster?: boolean
}

/** Shown for any path the test did not mount, so navigation away can be asserted without loading another page. */
export function OtherRoute() {
  return <p data-testid="other-route">Another page</p>
}

/**
 * Render `element` (a page or feature, imported directly rather than as a lazy chunk) in a memory router at `path`,
 * with a fresh query client, tooltips and the toaster, and nothing else: no shell, no other pages. Every other path
 * renders `OtherRoute`, so `router.state.location` shows where a link or redirect went.
 */
export function renderRoute(
  element: React.ReactElement,
  path = "/",
  { route = "*", routes: extra = [], children, toaster = true }: RenderRouteOptions = {},
) {
  const queryClient = createTestQueryClient()
  const page = <React.Suspense fallback={<p>Loading…</p>}>{element}</React.Suspense>
  const routeList: RouteObject[] = [{ path: route, element: page, children }, ...extra]
  if (route !== "*") routeList.push({ path: "*", element: <OtherRoute /> })
  const router = createMemoryRouter(routeList, { initialEntries: [path] })
  const user = userEvent.setup()
  const utils = render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
      {toaster ? <Toaster /> : null}
    </Providers>,
  )
  return { ...utils, user, router, queryClient }
}

/** Render a component with a query client (no router). */
export function renderWithClient(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return { ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>), queryClient }
}
