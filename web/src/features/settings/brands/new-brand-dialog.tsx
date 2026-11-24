import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, TriangleAlertIcon } from "lucide-react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"
import { useCreateBrand } from "@/api/brands"
import type { BrandListItem } from "@/api/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { FieldGroup, FieldSeparator } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/api"
import { SelectField, TextField } from "../form-fields"
import { applyServerErrors, type UnplacedError } from "../server-errors"
import { newBrandFieldFor, newBrandFile, type NewBrandValues } from "./brand-form"

const BLANK: NewBrandValues = { id: "", inheritsFrom: "", legalName: "", shortName: "", business: "", email: "", phone: "", website: "" }

/** The id rule is the backend's (src/services/workspaceFiles.js BRAND_ID); repeated here to answer before saving. */
const schemaFor = (taken: Set<string>) =>
  z.object({
    id: z
      .string()
      .trim()
      .min(1, "Enter an id")
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lowercase letters, digits, "-" or "_"')
      .refine((v) => !taken.has(v), "A brand with this id already exists"),
    inheritsFrom: z.string(),
    legalName: z.string(),
    shortName: z.string(),
    business: z.string(),
    email: z.string(),
    phone: z.string(),
    website: z.string(),
  })

/** "New brand" button + dialog: writes the brand's first brand.json and opens its editor. */
export function NewBrandDialog({ brands }: { brands: BrandListItem[] }) {
  const [open, setOpen] = React.useState(false)
  const taken = React.useMemo(() => new Set(brands.map((b) => b.id)), [brands])
  const form = useForm<NewBrandValues>({ defaultValues: BLANK, resolver: zodResolver(schemaFor(taken)) })
  const create = useCreateBrand()
  const navigate = useNavigate()
  const [failure, setFailure] = React.useState<{ error: unknown; unplaced: UnplacedError[] } | null>(null)
  const inheritsFrom = form.watch("inheritsFrom")
  const optional = inheritsFrom ? " (blank inherits)" : ""

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      form.reset(BLANK)
      setFailure(null)
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null)
    try {
      const detail = await create.mutateAsync(newBrandFile(values))
      toast.success(`Brand ${detail.id} created`)
      onOpenChange(false)
      void navigate(`/settings/brands/${encodeURIComponent(detail.id)}`)
    } catch (err) {
      const id = values.id.trim()
      const { unplaced } = applyServerErrors(err, form.setError, newBrandFieldFor, `brands/${id}/brand.json`)
      setFailure({ error: err, unplaced })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          New brand
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New brand</DialogTitle>
          <DialogDescription>Creates brands/&lt;id&gt;/brand.json. Everything else is edited on the brand's page.</DialogDescription>
        </DialogHeader>
        <form id="new-brand-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <FieldGroup>
            {failure ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Not created</AlertTitle>
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
            <TextField control={form.control} name="id" label="Id" description='The folder name: lowercase letters, digits, "-" or "_".' placeholder="acme-studio" />
            <SelectField
              control={form.control}
              name="inheritsFrom"
              label="Inherits from"
              options={[{ value: "", label: "None" }, ...brands.map((b) => ({ value: b.id, label: `${b.id} (${b.legalName})` }))]}
            />
            <TextField control={form.control} name="legalName" label={`Legal name${optional}`} />
            <TextField control={form.control} name="shortName" label={`Short name${optional}`} />
            <TextField control={form.control} name="business" label={`Business address${optional}`} description="One line per row." multiline />
            <FieldSeparator>Default contact</FieldSeparator>
            <TextField control={form.control} name="email" label="Email" type="email" />
            <TextField control={form.control} name="phone" label="Phone" type="tel" />
            <TextField control={form.control} name="website" label="Website" />
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="new-brand-form" disabled={create.isPending}>
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            Create brand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
