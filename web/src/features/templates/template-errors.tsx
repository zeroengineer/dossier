import { TriangleAlertIcon } from "lucide-react"
import type { TemplateLoadError } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { sourceLabel } from "./labels"

/** Template folders that failed to load: id, source and the loader's message. Renders nothing when there are none. */
export function TemplateErrors({ errors }: { errors: TemplateLoadError[] }) {
  if (errors.length === 0) return null
  const title = errors.length === 1 ? "1 template failed to load" : `${errors.length} templates failed to load`
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>Fix these template folders; the other templates are unaffected.</p>
        <ul className="flex flex-col gap-1">
          {errors.map((e) => (
            <li key={`${e.source}:${e.id}`} data-testid="template-error">
              <span className="font-mono font-medium">{e.id}</span>{" "}
              <span className="text-muted-foreground">
                ({sourceLabel(e.source)}, {e.code})
              </span>
              : {e.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
