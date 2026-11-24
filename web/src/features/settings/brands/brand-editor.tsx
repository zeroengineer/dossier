import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"
import { useForm, useFormState, type FieldPath } from "react-hook-form"
import { useBlocker, useSearchParams } from "react-router"
import { toast } from "sonner"
import { useSaveBrand } from "@/api/brands"
import type { BrandAssetUpload, BrandDetail, BrandFile, ResolvedBrand } from "@/api/types"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/lib/api"
import { SaveBar } from "../save-bar"
import { applyServerErrors, type UnplacedError } from "../server-errors"
import { AssetsSection } from "./assets-section"
import { TAB_OF_FIELD, toBrandFile, toFormValues, type BrandContext, type BrandFormValues } from "./brand-form"
import { BrandPreview } from "./brand-preview"
import {
  AddressesSection, AdvancedSection, BankSection, ContactsSection, FontsSection, FooterSection, IdentitySection,
  LetterheadSection, PaletteSection, RegistrationsSection, SeriesSection, SignatoriesSection, StringsSection, TaxSection,
  type SectionProps,
} from "./sections"

/** Editor tabs in display order. */
export const BRAND_TABS = [
  { id: "identity", label: "Identity" },
  { id: "registrations", label: "Registrations" },
  { id: "addresses", label: "Addresses" },
  { id: "contacts", label: "Contacts" },
  { id: "bank", label: "Bank accounts" },
  { id: "letterhead", label: "Letterhead" },
  { id: "footer", label: "Footer" },
  { id: "palette", label: "Palette" },
  { id: "fonts", label: "Fonts" },
  { id: "assets", label: "Assets" },
  { id: "signatories", label: "Signatories" },
  { id: "strings", label: "Strings" },
  { id: "tax", label: "Tax" },
  { id: "series", label: "Series" },
  { id: "advanced", label: "Advanced" },
] as const

const FORM_ID = "brand-form"

interface BrandEditorProps {
  brand: BrandDetail
  /** The resolved parent brand of an inheriting brand (null otherwise). */
  parent: ResolvedBrand | null
  fontWeights: string[]
  builtinFonts: string[]
  seriesIds: string[]
  assetMaxBytes: number
}

/** The brand file as one form: tabs per section, saved whole with `PUT /api/brands/:id`, preview beside it. */
export function BrandEditor({ brand, parent, fontWeights, builtinFonts, seriesIds, assetMaxBytes }: BrandEditorProps) {
  const id = brand.id
  const parentId = typeof brand.file.inheritsFrom === "string" && brand.file.inheritsFrom ? brand.file.inheritsFrom : null
  const contextOf = React.useCallback(
    (resolved: ResolvedBrand): BrandContext => ({ resolved, parent, fontWeights }),
    [parent, fontWeights],
  )

  // The stored file the form was last loaded from: the base every save starts from (keys the form does not edit).
  const [base, setBase] = React.useState<{ file: BrandFile; ctx: BrandContext }>(() => ({ file: brand.file, ctx: contextOf(brand.resolved) }))
  const form = useForm<BrandFormValues>({ defaultValues: toFormValues(brand.file, contextOf(brand.resolved)) })
  const { isDirty, errors } = useFormState({ control: form.control })
  const save = useSaveBrand(id)
  const [failure, setFailure] = React.useState<{ error: unknown; unplaced: UnplacedError[] } | null>(null)

  const [params, setParams] = useSearchParams()
  const requested = params.get("tab")
  const tab = BRAND_TABS.some((t) => t.id === requested) ? (requested as string) : "identity"
  const setTab = (next: string) =>
    setParams((p) => {
      const out = new URLSearchParams(p)
      if (next === "identity") out.delete("tab")
      else out.set("tab", next)
      return out
    }, { replace: true })
  const jumpTo = (field: string | undefined) => {
    const t = field ? TAB_OF_FIELD[field.split(".")[0] ?? ""] : undefined
    if (t) setTab(t)
  }
  const tabsWithErrors = new Set(Object.keys(errors).map((k) => TAB_OF_FIELD[k]).filter(Boolean))

  const load = (detail: BrandDetail, opts?: { keepDirtyValues?: boolean }) => {
    const ctx = contextOf(detail.resolved)
    setBase({ file: detail.file, ctx })
    form.reset(toFormValues(detail.file, ctx), opts)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    form.clearErrors()
    setFailure(null)
    const { body, problems, fieldFor } = toBrandFile(form.getValues(), base.file)
    if (problems.length) {
      for (const p of problems) form.setError(p.field as FieldPath<BrandFormValues>, { type: "client", message: p.message })
      jumpTo(problems[0]?.field)
      toast.error("Not saved", { description: "Fix the marked fields." })
      return
    }
    try {
      const detail = await save.mutateAsync(body)
      load(detail)
      toast.success("Brand saved")
    } catch (err) {
      const { placed, unplaced } = applyServerErrors(err, form.setError, fieldFor, `brands/${id}/brand.json`)
      setFailure({ error: err, unplaced })
      jumpTo(placed[0])
      toast.error("Not saved", { description: errorMessage(err) })
    }
  }

  /** An upload rewrote brand.json: take the new file, keeping unsaved edits, and show the uploaded path. */
  const onUploaded = (r: BrandAssetUpload) => {
    load(r.brand, { keepDirtyValues: true })
    const next = toFormValues(r.brand.file, contextOf(r.brand.resolved))
    const slot = r.key.replace(/^assets\./, "")
    if (slot === "logo" || slot === "seal" || slot === "watermark") form.setValue(`assets.${slot}`, next.assets[slot])
    else if (slot.startsWith("font:")) {
      const w = slot.slice(5)
      form.setValue(`fonts.${w}`, next.fonts[w] ?? "")
    } else if (slot.startsWith("signature:") || slot.startsWith("signature-large:")) {
      // keepDirtyValues may have kept the old rows (any signatory edit makes them dirty): set the uploaded path on the
      // row with that signatory id, or take the server's rows when it made the list the brand's own (inheriting brand).
      const sid = slot.slice(slot.indexOf(":") + 1)
      const prop = slot.startsWith("signature-large:") ? "signatureLarge" : "signature"
      const uploaded = next.signatories.rows.find((s) => s.id === sid)?.[prop] ?? ""
      const current = form.getValues("signatories")
      const i = current.rows.findIndex((s) => s.id.trim() === sid)
      if (parentId && !current.override) form.setValue("signatories", next.signatories, { shouldDirty: true })
      else if (i >= 0) form.setValue(`signatories.rows.${i}.${prop}`, uploaded, { shouldDirty: true })
    }
  }

  // Leaving with unsaved changes asks first (in-app navigation and closing the tab).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname)
  React.useEffect(() => {
    if (!isDirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  const section: SectionProps = { form, file: base.file, ctx: base.ctx, parentId }

  return (
    <>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form id={FORM_ID} onSubmit={(e) => void onSubmit(e)} noValidate aria-label={`Brand ${id}`} className="flex min-w-0 flex-col gap-4">
          {failure ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>
                <p>{errorMessage(failure.error)}</p>
                {failure.unplaced.length ? (
                  <ul className="list-inside list-disc">
                    {failure.unplaced.map((u) => <li key={u.text}>{u.text}</li>)}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start">
              {BRAND_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="flex-none" aria-invalid={tabsWithErrors.has(t.id) || undefined}>
                  {t.label}
                  {tabsWithErrors.has(t.id) ? (
                    <>
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
                      <span className="sr-only"> (has errors)</span>
                    </>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="identity"><IdentitySection {...section} /></TabsContent>
            <TabsContent value="registrations"><RegistrationsSection {...section} /></TabsContent>
            <TabsContent value="addresses"><AddressesSection {...section} /></TabsContent>
            <TabsContent value="contacts"><ContactsSection {...section} /></TabsContent>
            <TabsContent value="bank"><BankSection {...section} /></TabsContent>
            <TabsContent value="letterhead"><LetterheadSection {...section} /></TabsContent>
            <TabsContent value="footer"><FooterSection {...section} /></TabsContent>
            <TabsContent value="palette"><PaletteSection {...section} /></TabsContent>
            <TabsContent value="fonts"><FontsSection {...section} builtinFonts={builtinFonts} /></TabsContent>
            <TabsContent value="assets">
              <AssetsSection {...section} brandId={id} maxBytes={assetMaxBytes} onUploaded={onUploaded} />
            </TabsContent>
            <TabsContent value="signatories"><SignatoriesSection {...section} /></TabsContent>
            <TabsContent value="strings"><StringsSection {...section} /></TabsContent>
            <TabsContent value="tax"><TaxSection {...section} /></TabsContent>
            <TabsContent value="series"><SeriesSection {...section} seriesIds={seriesIds} /></TabsContent>
            <TabsContent value="advanced"><AdvancedSection {...section} /></TabsContent>
          </Tabs>
        </form>
        <BrandPreview brandId={id} configHash={brand.configHash} />
      </div>
      <SaveBar form={FORM_ID} dirty={isDirty} saving={save.isPending} onDiscard={() => form.reset()} saveLabel="Save brand" />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset()
        }}
        title="Leave without saving?"
        description="Your unsaved changes to this brand will be lost."
        confirmLabel="Leave"
        onConfirm={() => blocker.proceed?.()}
      />
    </>
  )
}
