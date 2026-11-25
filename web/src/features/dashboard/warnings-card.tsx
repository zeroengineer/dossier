import { ArrowRightIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react"
import { Link } from "react-router"
import type { DashboardWarning } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const TITLES: Record<string, string> = {
  NUMBER_CONFLICT: "Number conflict",
  BRAND_ASSET_MISSING: "Brand assets missing",
}

const titleOf = (code: string) => TITLES[code] ?? (code.startsWith("TEMPLATE") ? "Template does not load" : code)

/** Problems the server found (templates, number conflicts, brand assets), each linking to where it is fixed. */
export function WarningsCard({ warnings }: { warnings: DashboardWarning[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Warnings</CardTitle>
        <CardDescription>{warnings.length ? "Things to fix in this workspace" : "Nothing needs attention"}</CardDescription>
        {warnings.length ? (
          <CardAction>
            <Badge variant="outline" className="tabular-nums">{warnings.length}</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {warnings.length ? (
          <ul className="flex flex-col gap-2" aria-label="Warnings">
            {warnings.map((w, i) => (
              <li key={`${w.code}:${w.href}:${i}`}>
                {/* Static list items, not live announcements: drop the shared Alert's role="alert". */}
                <Alert role={undefined}>
                  <TriangleAlertIcon />
                  <AlertTitle>{titleOf(w.code)}</AlertTitle>
                  <AlertDescription>
                    <span>{w.message}</span>{" "}
                    <Link to={w.href} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
                      Fix
                      <ArrowRightIcon className="size-3.5" />
                    </Link>
                  </AlertDescription>
                </Alert>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-success" />
            No warnings
          </div>
        )}
      </CardContent>
    </Card>
  )
}
