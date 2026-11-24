import { Building2Icon } from "lucide-react"
import { useParams } from "react-router"
import { PlaceholderPage } from "@/components/placeholder-page"

export default function EntityPage() {
  const { id = "" } = useParams()
  return <PlaceholderPage title={id} description="Entity details, aliases and relations." icon={Building2Icon} />
}
