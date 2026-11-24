import type { LucideIcon } from "lucide-react"
import { ConstructionIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"

interface PlaceholderPageProps {
  title: string
  description: string
  icon?: LucideIcon
}

/** A page whose feature is not built yet: its real header and an intentional empty state. */
export function PlaceholderPage({ title, description, icon = ConstructionIcon }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title="This page is being built"
        description="It arrives in an upcoming step of the new interface. The rest of the app keeps working meanwhile."
        className="min-h-80 flex-none"
      />
    </>
  )
}
