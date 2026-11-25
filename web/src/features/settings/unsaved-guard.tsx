import * as React from "react"
import { useBlocker } from "react-router"
import { ConfirmDialog } from "@/components/confirm-dialog"

/**
 * While `dirty`, leaving the page asks first: in-app navigation to another path opens a confirm dialog, closing or
 * reloading the tab gets the browser's prompt. `what` names the unsaved thing ("this brand", "the series").
 */
export function UnsavedChangesGuard({ dirty, what }: { dirty: boolean; what: string }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  React.useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open && blocker.state === "blocked") blocker.reset()
      }}
      title="Leave without saving?"
      description={`Your unsaved changes to ${what} will be lost.`}
      confirmLabel="Leave"
      onConfirm={() => blocker.proceed?.()}
    />
  )
}
