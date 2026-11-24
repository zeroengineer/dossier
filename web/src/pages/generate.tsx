import { FilePlus2Icon } from "lucide-react"
import { useParams } from "react-router"
import { PlaceholderPage } from "@/components/placeholder-page"

export default function GeneratePage() {
  const { templateId } = useParams()
  return (
    <PlaceholderPage
      title={templateId ? `Generate: ${templateId}` : "Generate"}
      description="Pick a template, fill in its fields and preview the document before it is numbered."
      icon={FilePlus2Icon}
    />
  )
}
