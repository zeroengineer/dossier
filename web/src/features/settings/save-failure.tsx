import * as React from "react"
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ApiError, errorMessage } from "@/lib/api"
import type { UnplacedError } from "./server-errors"

/** The text of the Alert shown when a whole-file save is refused because the file changed elsewhere. */
export const CONFLICT_TEXT =
  "This file changed elsewhere since you opened it. Reload to see the latest version; your unsaved edits will be lost."

/** True for 409 CONFLICT: the file changed since the editor loaded it (its `If-Match` hash no longer matches). */
export const isConflict = (err: unknown) => err instanceof ApiError && err.code === "CONFLICT"

/** A failed save as the settings editors keep it: the error and the server field errors no form field shows. */
export interface SaveFailure {
  error: unknown
  unplaced: UnplacedError[]
}

interface SaveFailureAlertProps {
  failure: SaveFailure | null
  /** Reload the file from the server, dropping unsaved edits (offered on a conflict). */
  onReload: () => Promise<unknown>
}

/**
 * The Alert above a settings form after a failed save: the error with any unplaced field errors, or, when the file
 * changed elsewhere (409 CONFLICT), the conflict notice with a Reload button. Nothing is ever overwritten silently.
 */
export function SaveFailureAlert({ failure, onReload }: SaveFailureAlertProps) {
  const [reloading, setReloading] = React.useState(false)
  if (!failure) return null
  if (isConflict(failure.error)) {
    const reload = async () => {
      setReloading(true)
      try {
        await onReload()
      } finally {
        setReloading(false)
      }
    }
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Not saved</AlertTitle>
        <AlertDescription>
          <p>{CONFLICT_TEXT}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={reloading} onClick={() => void reload()}>
            <RefreshCwIcon data-icon="inline-start" />
            Reload
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Not saved</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(failure.error)}</p>
        {failure.unplaced.length ? (
          <ul className="list-inside list-disc">
            {failure.unplaced.map((u) => <li key={u.text}>{u.text}</li>)}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
