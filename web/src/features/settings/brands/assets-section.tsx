import * as React from "react"
import { ImageOffIcon, TypeIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { useBrandAssets, useUploadBrandAsset } from "@/api/brands"
import type { BrandAsset, BrandAssetUpload } from "@/api/types"
import { ErrorState } from "@/components/error-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, errorMessage } from "@/lib/api"
import { TextField } from "../form-fields"
import { Section } from "../section"
import type { SectionProps } from "./sections"

/** Display name of an asset slot key. */
export function slotLabel(key: string): string {
  if (key === "assets.logo") return "Logo"
  if (key === "assets.seal") return "Seal"
  if (key === "assets.watermark") return "Watermark"
  const [kind, arg = ""] = key.split(":")
  if (kind === "signature") return `Signature: ${arg}`
  if (kind === "signature-large") return `Large signature: ${arg}`
  if (kind === "font") return `Font: ${arg}`
  return key
}

/** What a slot's source means for the user. Whether the brand has its own file is `present`, never `version`. */
export function sourceLabel(a: Pick<BrandAsset, "key" | "source">): string {
  switch (a.source) {
    case "configured":
      return "Own file"
    case "default":
      return "Default file"
    case "fallback":
      return a.key.startsWith("font:") ? "Built-in fallback" : "Uses the signature"
    case "placeholder":
      return "Placeholder"
    default:
      return "Not set"
  }
}

const isFont = (key: string) => key.startsWith("font:")
const formatMb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`

interface AssetSlotProps {
  brandId: string
  asset: BrandAsset
  maxBytes: number
  onUploaded: (r: BrandAssetUpload) => void
}

function AssetSlot({ brandId, asset, maxBytes, onUploaded }: AssetSlotProps) {
  const input = React.useRef<HTMLInputElement>(null)
  const upload = useUploadBrandAsset(brandId)
  const label = slotLabel(asset.key)
  const font = isFont(asset.key)

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (file.size > maxBytes) {
      toast.error(`${label}: the file is too large`, { description: `Assets are limited to ${formatMb(maxBytes)}; this file is ${formatMb(file.size)}.` })
      return
    }
    upload.mutate(
      { key: asset.key, file },
      {
        onSuccess: (r) => {
          onUploaded(r)
          toast.success(`${label} uploaded`, { description: r.path })
        },
        onError: (err) => {
          const tooLarge = err instanceof ApiError && err.status === 413
          toast.error(tooLarge ? `${label}: the file is too large` : `${label}: upload failed`, {
            description: tooLarge ? `Assets are limited to ${formatMb(maxBytes)}.` : [errorMessage(err), ...(err instanceof ApiError ? err.errors : [])].join("\n"),
          })
        },
      },
    )
  }

  return (
    <Card size="sm" aria-label={label} role="group">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {label}
          <Badge variant={asset.present ? "secondary" : "outline"}>{sourceLabel(asset)}</Badge>
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs" title={asset.path ?? undefined}>
          {asset.path ?? "No file"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {font ? (
            <TypeIcon className="text-muted-foreground" aria-hidden="true" />
          ) : asset.source ? (
            <img src={asset.url} alt={`${label} of ${brandId}`} className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageOffIcon className="text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={`Upload ${label}`}
          accept={font ? ".ttf,.otf,font/ttf,font/otf" : "image/png,image/jpeg"}
          onChange={onFile}
        />
        <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
          {asset.present ? "Replace" : "Upload"}
        </Button>
      </CardContent>
    </Card>
  )
}

interface AssetsSectionProps extends SectionProps {
  brandId: string
  maxBytes: number
  onUploaded: (r: BrandAssetUpload) => void
}

/** Image paths plus one upload card per asset slot (logo, seal, watermark, signatures, fonts). */
export function AssetsSection(p: AssetsSectionProps) {
  const { form, brandId, maxBytes, onUploaded, parentId, ctx } = p
  const assets = useBrandAssets(brandId)
  const ph = (slot: "logo" | "seal" | "watermark") => (parentId ? ctx.parent?.assets[slot] : undefined)
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Image paths"
        description={`Paths are relative to the brand folder. Uploading below fills them in. PNG or JPEG images and TTF or OTF fonts, up to ${formatMb(maxBytes)}; a missing image prints a grey placeholder.`}
      >
        <TextField control={form.control} name="assets.logo" label="Logo path" placeholder={ph("logo")} />
        <TextField control={form.control} name="assets.seal" label="Seal path" placeholder={ph("seal")} />
        <TextField control={form.control} name="assets.watermark" label="Watermark path" placeholder={ph("watermark")} />
      </Section>
      <section aria-label="Asset files" className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-medium">Files</h2>
        {assets.isError ? (
          <ErrorState error={assets.error} title="Could not load the assets" onRetry={() => void assets.refetch()} />
        ) : assets.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {assets.data.assets.map((a) => (
              <AssetSlot key={a.key} brandId={brandId} asset={a} maxBytes={maxBytes} onUploaded={onUploaded} />
            ))}
          </div>
        )}
        <p className="text-sm text-muted-foreground">Uploads are saved at once; signatures appear here for the saved signatories.</p>
      </section>
    </div>
  )
}
