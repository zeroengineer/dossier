import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Label of the confirm button (default "Confirm"). */
  confirmLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
  /** Outlined red confirm button (default true): for deleting, unlinking, superseding. False: the primary button. */
  destructive?: boolean
  /**
   * Runs on confirm. The dialog shows a pending state until the promise settles, closes on success and stays open on
   * failure (the error is left to the caller, e.g. the mutation's toast).
   */
  onConfirm: () => void | Promise<unknown>
  /** External pending state (e.g. `mutation.isPending`), combined with the dialog's own. */
  pending?: boolean
  /** Element that opens the dialog (rendered with `asChild`). Omit when controlling `open`. */
  trigger?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Confirmation for destructive or irreversible actions (AlertDialog). */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
  pending: pendingProp = false,
  trigger,
  open: openProp,
  onOpenChange,
}: ConfirmDialogProps) {
  const [openInner, setOpenInner] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const open = openProp ?? openInner
  const pending = running || pendingProp

  function setOpen(next: boolean) {
    if (!next && pending) return
    if (openProp === undefined) setOpenInner(next)
    onOpenChange?.(next)
  }

  async function confirm(event: React.MouseEvent) {
    // Keep the dialog open while the action runs; close it only on success.
    event.preventDefault()
    setRunning(true)
    try {
      await onConfirm()
      setRunning(false)
      if (openProp === undefined) setOpenInner(false)
      onOpenChange?.(false)
    } catch {
      setRunning(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            className={cn(destructive && "border-destructive")}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={confirm}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
