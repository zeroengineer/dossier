import { Fragment } from "react"
import { Link, useMatches, type UIMatch } from "react-router"
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

/** Route `handle`: `crumb` is a label, or a function of the match (for ids in the path). */
export interface RouteHandle {
  crumb?: string | ((match: UIMatch) => string)
}

interface Crumb {
  id: string
  label: string
  to: string
}

export function useCrumbs(): Crumb[] {
  const matches = useMatches()
  const crumbs: Crumb[] = []
  for (const match of matches) {
    const handle = match.handle as RouteHandle | undefined
    if (!handle?.crumb) continue
    const label = typeof handle.crumb === "function" ? handle.crumb(match) : handle.crumb
    crumbs.push({ id: match.id, label, to: match.pathname })
  }
  return crumbs
}

export function Breadcrumbs() {
  const crumbs = useCrumbs()
  if (!crumbs.length) return null
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={crumb.id}>
              {i > 0 ? <BreadcrumbSeparator className={i < crumbs.length - 1 ? "hidden md:block" : undefined} /> : null}
              <BreadcrumbItem className={last ? undefined : "hidden md:inline-flex"}>
                {last ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
