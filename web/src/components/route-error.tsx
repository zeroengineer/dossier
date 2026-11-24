import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router"
import { ErrorState } from "@/components/error-state"

/** Error element for routes: shows what failed and offers a reload of the current page. */
export function RouteError() {
  const error = useRouteError()
  const navigate = useNavigate()
  const shown = isRouteErrorResponse(error) ? new Error(`${error.status} ${error.statusText}`) : error
  return <ErrorState error={shown} title="This page failed to load" onRetry={() => navigate(0)} className="min-h-80 flex-none" />
}

/** Last-resort error element outside the shell (the shell itself failed). */
export function RootError() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <RouteError />
    </div>
  )
}
