import type { Status } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const DOT: Record<Status, string> = {
  Draft: "bg-status-draft",
  Sent: "bg-status-sent",
  Signed: "bg-status-signed",
  Paid: "bg-status-paid",
  Superseded: "bg-status-superseded",
}

/** A document status as an outlined badge with a coloured dot (colours from the --status-* tokens). */
export function StatusBadge({ status, className }: { status: Status | string; className?: string }) {
  const dot = DOT[status as Status] ?? "bg-muted-foreground"
  return (
    <Badge variant="outline" className={className}>
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {status}
    </Badge>
  )
}
