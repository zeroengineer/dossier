import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"
import { useDocument } from "@/api/document"
import { useMe } from "@/api/me"
import { useTemplate } from "@/api/templates"
import type { BrandSummary, DocumentDetail, TemplateDetail } from "@/api/types"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { ApiError } from "@/lib/api"
import { useActiveBrand } from "@/lib/active-brand"
import { GenerateFields, useGenerateForm } from "./form"
import { GenerateActionBar, useGenerateAction } from "./generate-action"
import { GeneratePreview } from "./preview"
import { unofferedChoices } from "./schema"
import { isObj } from "./to-input"

/**
 * `/generate/:templateId`: the template's form next to its preview. The brand starts as the sidebar's active brand;
 * changing it here reloads the fields (enum choices can come from the brand) and keeps what was typed.
 */
export function GenerateTemplate({ templateId }: { templateId: string }) {
  const me = useMe()
  const { brand: activeBrand, brands } = useActiveBrand(me.data)
  const [picked, setPicked] = React.useState<string | null>(null)
  // Regenerate mode (`?documentId=`): the document's issuing brand, its current input, its status.
  const [params, setParams] = useSearchParams()
  const documentId = params.get("documentId") ?? ""
  const doc = useDocument(documentId)
  const regenerate = documentId ? (doc.data ?? null) : null
  const brandId = documentId ? (doc.data?.issuingBrandId ?? null) : (picked ?? activeBrand?.id ?? null)
  // Wait for /api/me (and the document) so the first fetch already asks for the right brand's fields.
  const template = useTemplate(templateId, brandId, { enabled: !me.isPending && (!documentId || doc.isSuccess) })

  // Leave regenerate mode keeping the form (same element, same key): a new document from the same input and brand.
  const generateNew = React.useCallback(() => {
    if (regenerate?.issuingBrandId) setPicked(regenerate.issuingBrandId)
    setParams({}, { replace: false })
  }, [regenerate, setParams])

  if (documentId && doc.isError) {
    return <ErrorState error={doc.error} title="Could not load the document to regenerate" onRetry={() => void doc.refetch()} />
  }
  if (regenerate && regenerate.template?.id !== templateId) {
    return (
      <ErrorState
        error={new Error(`${regenerate.id} was not generated from the template "${templateId}".`)}
        title="Cannot regenerate with this template"
      />
    )
  }
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
  if (!template.data || (documentId && !regenerate)) return <PageSkeleton />
  return (
    <GenerateWorkspace
      key={templateId}
      template={template.data}
      brands={brands}
      brandId={brandId}
      isPlaceholderData={template.isPlaceholderData}
      onBrandChange={setPicked}
      regenerate={regenerate}
      onGenerateNew={generateNew}
    />
  )
}

/** The current version's generator input of a document (the form's starting values when regenerating). */
function currentInput(doc: DocumentDetail | null): Record<string, unknown> | undefined {
  const input = doc?.versions.find((v) => v.isCurrent)?.input
  return isObj(input) ? input : undefined
}

interface GenerateWorkspaceProps {
  template: TemplateDetail
  brands: BrandSummary[]
  brandId: string | null
  /** The fields shown are the previous brand's while the selected brand's load. */
  isPlaceholderData: boolean
  onBrandChange: (id: string) => void
  /** The document being regenerated (`?documentId=`), or null for a new document. */
  regenerate: DocumentDetail | null
  onGenerateNew: () => void
}

function GenerateWorkspace({
  template,
  brands,
  brandId,
  isPlaceholderData,
  onBrandChange,
  regenerate,
  onGenerateNew,
}: GenerateWorkspaceProps) {
  const form = useGenerateForm(template, currentInput(regenerate))
  const action = useGenerateAction({ template, form, brandId, regenerate })
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
      onSubmit={(e) => void form.handleSubmit(action.onValid)(e)}
      className="flex flex-col gap-6"
    >
      {brands.length ? (
        <Field data-disabled={regenerate ? true : undefined}>
          <FieldLabel htmlFor="generate-brand">Brand</FieldLabel>
          <Select value={brandId ?? undefined} onValueChange={onBrandChange} disabled={Boolean(regenerate)}>
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
          {regenerate ? <FieldDescription>A new version keeps the document's issuing brand.</FieldDescription> : null}
        </Field>
      ) : null}
      <GenerateFields template={template} form={form} />
      <GenerateActionBar action={action} onGenerateNew={regenerate ? onGenerateNew : undefined} />
    </form>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={meta.title}
        description={
          regenerate
            ? `Regenerating ${regenerate.docNumber ?? regenerate.id} (${regenerate.title}): a new version that keeps its number.`
            : meta.description
        }
        meta={
          <>
            <Badge variant="secondary">{meta.type}</Badge>
            <SensitivityBadge level={meta.sensitivity} />
            {regenerate ? <StatusBadge status={regenerate.status} /> : null}
          </>
        }
        actions={
          regenerate ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/documents/${encodeURIComponent(regenerate.id)}`}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back to {regenerate.docNumber ?? regenerate.id}
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link to="/generate">
                <ArrowLeftIcon data-icon="inline-start" />
                All templates
              </Link>
            </Button>
          )
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
        <ResizablePanelGroup className="h-[calc(100svh-12rem)] min-h-128 rounded-lg border bg-card shadow-md">
          <ResizablePanel defaultSize="55" minSize="30">
            <div className="h-full overflow-y-auto p-6">{formPane}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="45" minSize="25">
            <div className="h-full overflow-y-auto p-6">{preview}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
