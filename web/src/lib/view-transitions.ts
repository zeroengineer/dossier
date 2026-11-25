import type { createBrowserRouter } from "react-router"

type Router = ReturnType<typeof createBrowserRouter>
type To = Parameters<Router["navigate"]>[0]

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

/**
 * The pathname a navigation leads to, or null when it cannot be told (history steps, odd values). Relative paths
 * resolve against `href` (the caller passes `window.location.href`), not against the route that navigates: close
 * enough to tell "same page" from "another page", which is all this is used for.
 */
export function targetPathname(to: To, href: string): string | null {
  if (typeof to === "number" || to === null) return null
  try {
    if (typeof to === "string") return new URL(to, href).pathname
    if (to.pathname) return new URL(to.pathname, href).pathname
    return new URL(href).pathname
  } catch {
    return null
  }
}

/**
 * Whether a navigation should run as a view transition: only when the page (pathname) changes, so tab, filter and
 * pagination changes in the query string stay instant, and never when the system asks for reduced motion.
 */
export function wantsViewTransition(to: To, href: string, reducedMotion: boolean): boolean {
  if (reducedMotion) return false
  const next = targetPathname(to, href)
  return next !== null && next !== new URL(href).pathname
}

/**
 * Turns on React Router's `viewTransition` for every page change made through the router (links, `navigate()`,
 * redirects from components), unless the caller set it. The CSS in `globals.css` animates only the main area.
 */
export function withViewTransitions(router: Router): Router {
  const navigate = router.navigate.bind(router)
  router.navigate = ((to: To, opts?: Parameters<Router["navigate"]>[1]) => {
    if (typeof to === "number") return navigate(to)
    const reduced = typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches
    const viewTransition = opts?.viewTransition ?? wantsViewTransition(to, window.location.href, reduced)
    return navigate(to, { ...opts, viewTransition })
  }) as Router["navigate"]
  return router
}
