import { ExternalLinkIcon } from "lucide-react"
import { brandUrls } from "@/api/brands"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/** The saved brand's letterhead preview PDF; `configHash` changes the URL after every save so the frame reloads. */
export function BrandPreview({ brandId, configHash }: { brandId: string; configHash: string }) {
  const src = brandUrls.preview(brandId, configHash.slice(0, 12))
  return (
    <Card className="xl:sticky xl:top-20">
      <CardHeader>
        <CardTitle>Letterhead preview</CardTitle>
        <CardDescription>Letterhead, footer and the first signatory, with the saved settings.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="icon-sm">
            <a href={src} target="_blank" rel="noopener" aria-label="Open the preview PDF">
              <ExternalLinkIcon />
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <iframe title="Letterhead preview" src={src} className="aspect-[1/1.414] w-full rounded-md border bg-muted" />
      </CardContent>
    </Card>
  )
}
