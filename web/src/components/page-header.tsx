import type * as React from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
  title: React.ReactNode
  description?: React.ReactNode
  /** Badges or other inline status shown next to the title. */
  meta?: React.ReactNode
  /** Buttons aligned to the right (below the title on narrow screens). */
  actions?: React.ReactNode
}

export function PageHeader({ title, description, meta, actions, className, ...props }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)} {...props}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className="max-w-full min-w-0 truncate font-heading text-2xl font-semibold tracking-tight"
            title={typeof title === "string" ? title : undefined}
          >
            {title}
          </h1>
          {meta}
        </div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
