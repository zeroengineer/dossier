import { useParams } from "react-router"
import { PageHeader } from "@/components/page-header"
import { GenerateTemplate } from "@/features/generate/generate-view"
import { TemplatePicker } from "@/features/generate/picker"

/** `/generate` (template picker) and `/generate/:templateId` (the template's form and preview). */
export default function GeneratePage() {
  const { templateId } = useParams()
  if (templateId) return <GenerateTemplate templateId={templateId} />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Generate" description="Pick a template to fill in and preview before it is numbered." />
      <TemplatePicker />
    </div>
  )
}
