import { LayoutDashboardIcon } from "lucide-react"
import { useMe } from "@/api/me"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const KPIS = ["Documents", "Drafts awaiting status", "Amount invoiced", "Number conflicts"]

export default function DashboardPage() {
  const { data: me } = useMe()
  return (
    <>
      <PageHeader title="Dashboard" description={me ? `${me.workspace.name} at a glance.` : "Your workspace at a glance."} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((label) => (
          <Card key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums text-muted-foreground">—</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <EmptyState
        icon={LayoutDashboardIcon}
        title="The dashboard is being built"
        description="Key figures, documents over time, recent documents and warnings will appear here."
        className="min-h-72 flex-none"
      />
    </>
  )
}
