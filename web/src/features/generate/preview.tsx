import { FileSearchIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

/**
 * The preview pane of the generate page. Placeholder: F13 replaces it with the live draft preview
 * (`POST /api/templates/:id/preview`, debounced on form changes) plus the missing/invalid fields and warnings.
 */
export function GeneratePreview() {
  return (
    <EmptyState
      icon={FileSearchIcon}
      title="Preview"
      description="A draft of the document appears here as you fill in the form. Drafts are not numbered."
      className="h-full border-dashed"
    />
  )
}
