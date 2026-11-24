import { LayoutTemplateIcon } from "lucide-react"
import { useTemplates } from "@/api/templates"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { TemplateErrors } from "@/features/templates/template-errors"
import { TemplatesTable } from "@/features/templates/templates-table"

export default function TemplatesPage() {
  const { data, isPending, isError, error, refetch } = useTemplates()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Templates" description="The templates in your workspace and any problems loading them." />
      {isError ? (
        <ErrorState error={error} title="Could not load templates" onRetry={() => void refetch()} />
      ) : (
        <>
          {data ? <TemplateErrors errors={data.errors} /> : null}
          {data && data.templates.length === 0 ? (
            <EmptyState
              icon={LayoutTemplateIcon}
              title="No templates"
              description="Add a template folder under templates/ in the workspace to generate documents from it."
            />
          ) : (
            <TemplatesTable templates={data?.templates ?? []} isLoading={isPending} />
          )}
        </>
      )}
    </div>
  )
}
