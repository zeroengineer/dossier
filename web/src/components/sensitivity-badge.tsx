import { LockIcon } from "lucide-react"
import type { SensitivityLevel } from "@/api/types"
import { Badge } from "@/components/ui/badge"

/**
 * A sensitivity level or clearance. Public and Internal read as neutral; Confidential and Restricted carry a lock,
 * and Restricted is the one level drawn in the accent colour.
 */
export function SensitivityBadge({ level, className }: { level: SensitivityLevel | string; className?: string }) {
  const locked = level === "Confidential" || level === "Restricted"
  return (
    <Badge variant={level === "Restricted" ? "destructive" : level === "Public" ? "secondary" : "outline"} className={className}>
      {locked ? <LockIcon data-icon="inline-start" /> : null}
      {level}
    </Badge>
  )
}
