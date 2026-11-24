import { CompassIcon } from "lucide-react"
import { Link } from "react-router"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      description="There is no page at this address."
      action={
        <Button asChild>
          <Link to="/">Go to the dashboard</Link>
        </Button>
      }
      className="min-h-80 flex-none"
    />
  )
}
