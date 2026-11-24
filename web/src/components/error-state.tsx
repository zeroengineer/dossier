import { RotateCwIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ApiError, errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

interface ErrorStateProps {
  error: unknown
  title?: string
  /** Shows a Retry button when given. */
  onRetry?: () => void
  className?: string
}

export function ErrorState({ error, title = "Something went wrong", onRetry, className }: ErrorStateProps) {
  const errors = error instanceof ApiError ? error.errors : []
  return (
    <Empty role="alert" className={cn("border", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{errorMessage(error)}</EmptyDescription>
        {errors.length ? (
          <EmptyDescription>
            {errors.slice(0, 5).map((e) => (
              <span key={e} className="block">{e}</span>
            ))}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button variant="outline" onClick={onRetry}>
            <RotateCwIcon data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
