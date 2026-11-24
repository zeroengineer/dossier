import type { UseFormReturn } from "react-hook-form"
import { FileSearchIcon } from "lucide-react"
import type { TemplateDetail } from "@/api/types"
import { EmptyState } from "@/components/empty-state"
import type { FormValues } from "./to-input"

export interface GeneratePreviewProps {
  template: TemplateDetail
  /** The generate form: watch it, and read the input with `toInput(template.fields, form.getValues())`. */
  form: UseFormReturn<FormValues>
  /** The brand selected on the page (null: the workspace default); send it as the preview's `brandId`. */
  brandId: string | null
  /** True while `template` is still the previous brand's fields: skip previews until the new ones load. */
  isPlaceholderData: boolean
}

/**
 * The preview pane of the generate page. Placeholder: F13 replaces it with the live draft preview
 * (`previewTemplate` from api/generate.ts, debounced on form changes) plus the missing/invalid fields and warnings.
 */
export function GeneratePreview(_props: GeneratePreviewProps) {
  return (
    <EmptyState
      icon={FileSearchIcon}
      title="Preview"
      description="A draft of the document appears here as you fill in the form. Drafts are not numbered."
      className="h-full border-dashed"
    />
  )
}
