import { PaletteIcon } from "lucide-react"
import { useParams } from "react-router"
import { PlaceholderPage } from "@/components/placeholder-page"

export default function BrandSettingsPage() {
  const { id = "" } = useParams()
  return <PlaceholderPage title={id} description="Edit this brand as one form and preview its letterhead." icon={PaletteIcon} />
}
