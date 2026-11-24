import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { useMe } from "@/api/me"
import { useTemplate } from "@/api/templates"
import type { BrandSummary, TemplateDetail } from "@/api/types"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { ApiError } from "@/lib/api"
import { useActiveBrand } from "@/lib/active-brand"
import { GenerateFields, useGenerateForm } from "./form"
import { GeneratePreview } from "./preview"
import { unofferedChoices } from "./schema"

/**
 * `/generate/:templateId`: the template's form next to its preview. The brand starts as the sidebar's active brand;
 * changing it here reloads the fields (enum choices can come from the brand) and keeps what was typed.
 */
export function GenerateTemplate({ templateId }: { templateId: string }) {
  const me = useMe()
  const { brand: activeBrand, brands } = useActiveBrand(me.data)
  const [picked, setPicked] = React.useState<string | null>(null)
  const brandId = picked ?? activeBrand?.id ?? null
  // Wait for /api/me so the first fetch already asks for the active brand's fields.
  const template = useTemplate(templateId, brandId, { enabled: !me.isPending })

  if (template.isError) {
    const notFound = template.error instanceof ApiError && template.error.status === 404
    return (
      <ErrorState
        error={template.error}
        title={notFound ? "Template not found" : "Could not load the template"}
        onRetry={notFound ? undefined : () => void template.refetch()}
      />
    )
  }
  if (!template.data) return <PageSkeleton />
  return (
    <GenerateWorkspace
      key={templateId}
      template={template.data}
      brands={brands}
      brandId={brandId}
      isPlaceholderData={template.isPlaceholderData}
      onBrandChange={setPicked}
    />
  )
}

interface GenerateWorkspaceProps {
  template: TemplateDetail
  brands: BrandSummary[]
  brandId: string | null
  /** The fields shown are the previous brand's while the selected brand's load. */
  isPlaceholderData: boolean
  onBrandChange: (id: string) => void
}

function GenerateWorkspace({ template, brands, brandId, isPlaceholderData, onBrandChange }: GenerateWorkspaceProps) {
  const form = useGenerateForm(template)
  const isMobile = useIsMobile()
  const { meta } = template

  // A brand switch can change a brand-list enum's choices: clear values the new brand does not offer, and say so.
  const shownFields = React.useRef(template.fields)
  React.useEffect(() => {
    if (shownFields.current === template.fields) return
    shownFields.current = template.fields
    const cleared = unofferedChoices(template.fields, form.getValues())
    for (const f of cleared) form.setValue(f.name, "", { shouldDirty: true, shouldValidate: true })
    if (cleared.length) {
      toast.info(`Cleared ${cleared.map((f) => f.label).join(", ")}`, {
        description: "The value is not offered for this brand; the template default applies.",
      })
    }
  }, [template.fields, form])

  const preview = (
    <GeneratePreview template={template} form={form} brandId={brandId} isPlaceholderData={isPlaceholderData} />
  )

  const formPane = (
    <form
      noValidate
      aria-label={`${meta.title} fields`}
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-6"
    >
      {brands.length ? (
        <Field>
          <FieldLabel htmlFor="generate-brand">Brand</FieldLabel>
          <Select value={brandId ?? undefined} onValueChange={onBrandChange}>
            <SelectTrigger id="generate-brand" className="w-full max-w-sm">
              <SelectValue placeholder="Workspace default" />
            </SelectTrigger>
            <SelectContent>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <GenerateFields template={template} form={form} />
    </form>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={meta.title}
        description={meta.description}
        meta={
          <>
            <Badge variant="secondary">{meta.type}</Badge>
            <SensitivityBadge level={meta.sensitivity} />
          </>
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/generate">
              <ArrowLeftIcon data-icon="inline-start" />
              All templates
            </Link>
          </Button>
        }
      />
      {isMobile ? (
        <Tabs defaultValue="form">
          <TabsList>
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="form">{formPane}</TabsContent>
          <TabsContent value="preview" className="min-h-96">
            {preview}
          </TabsContent>
        </Tabs>
      ) : (
        <ResizablePanelGroup className="h-[calc(100svh-12rem)] min-h-[32rem] rounded-lg border bg-card shadow-md">
          <ResizablePanel defaultSize="55" minSize="30">
            <div className="h-full overflow-y-auto p-6">{formPane}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="45" minSize="25">
            <div className="h-full p-6">{preview}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
