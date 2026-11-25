import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

interface SaveBarProps {
  /** The form has unsaved changes. */
  dirty: boolean
  saving: boolean
  /** Undo every unsaved change. */
  onDiscard: () => void
  /** `form` attribute of the submit button, when the bar is rendered outside the form element. */
  form?: string
  saveLabel?: string
  className?: string
}

/**
 * Floating sticky bar at the bottom of a settings form: the unsaved-changes state, Discard and the submit button. Render it as
 * the last child of the page (or of the form) so it sticks to the bottom of the scrolling content.
 */
export function SaveBar({ dirty, saving, onDiscard, form, saveLabel = "Save changes", className }: SaveBarProps) {
  return (
    <div
      role="region"
      aria-label="Save changes"
      className={cn(
        "sticky bottom-2 z-10 flex items-center justify-between gap-3 rounded-xl border bg-background/80 py-2 pr-2 pl-4 shadow-lg backdrop-blur-md",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {saving ? "Saving…" : dirty ? "You have unsaved changes." : "All changes saved."}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={!dirty || saving}>
          Discard
        </Button>
        <Button type="submit" form={form} disabled={saving}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}
