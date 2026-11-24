import { useMe } from "@/api/me"
import { formatDate, parseDate, type DateStyle } from "@/lib/format"
import { cn } from "@/lib/utils"

/** A date (`2026-04-01`) or timestamp, formatted for the workspace locale, in a `<time>` element. */
export function DateText({ value, style = "medium", className }: { value: string | null | undefined; style?: DateStyle; className?: string }) {
  const { data: me } = useMe()
  if (!value) return <span className={cn("text-muted-foreground", className)}>—</span>
  const date = parseDate(value)
  return (
    <time dateTime={value} title={date ? date.toISOString() : undefined} className={cn("tabular-nums", className)}>
      {formatDate(value, style, me?.workspace.locale)}
    </time>
  )
}
