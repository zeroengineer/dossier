import { FileTextIcon } from "lucide-react"
import { useParams } from "react-router"
import { PlaceholderPage } from "@/components/placeholder-page"

export default function DocumentPage() {
  const { id = "" } = useParams()
  return <PlaceholderPage title={id} description="Document details, renditions, versions and relations." icon={FileTextIcon} />
}
