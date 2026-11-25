import * as React from "react"
import { CheckIcon, ChevronsUpDownIcon, LinkIcon } from "lucide-react"
import { toast } from "sonner"
import { useLinkDocument, useLinkSearch } from "@/api/document-actions"
import { useMeta } from "@/api/meta"
import type { DocumentDetail, DocumentSummary } from "@/api/types"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { DEBOUNCE_MS, useDebounced } from "@/hooks/use-debounced"
import { cn } from "@/lib/utils"

/** `based_on` → `based on`. */
export const relationLabel = (type: string) => type.replaceAll("_", " ")

/**
 * Relation types a document-to-document link can use. `generated_from` points at a template
 * (`template:<id>@<version>`), which the generator records, so the picker leaves it out.
 */
export const linkableTypes = (types: string[]) => types.filter((t) => t !== "generated_from")

interface DocumentPickerProps {
  id: string
  /** The document being edited: never offered. */
  excludeId: string
  value: DocumentSummary | null
  onChange: (doc: DocumentSummary) => void
  invalid?: boolean
}

/** Searchable document picker (Popover + Command over `GET /api/search`, debounced). */
export function DocumentPicker({ id, excludeId, value, onChange, invalid }: DocumentPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const debounced = useDebounced(q, DEBOUNCE_MS)
  const search = useLinkSearch(debounced)
  const hits = (search.data?.hits ?? []).map((h) => h.document).filter((d) => d.id !== excludeId)
  const typing = q.trim() !== "" && (q !== debounced || search.isFetching)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? `${value.title} · ${value.docNumber ?? value.id}` : "Search by number, title or party"}
          </span>
          <ChevronsUpDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false} label="Search documents">
          <CommandInput placeholder="Search documents" value={q} onValueChange={setQ} />
          <CommandList>
            {typing ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner />
                Searching
              </div>
            ) : (
              <CommandEmpty>
                {!q.trim() ? "Type to search documents." : search.isError ? "Could not search documents." : "No documents found."}
              </CommandEmpty>
            )}
            {!typing && hits.length ? (
              <CommandGroup heading="Documents">
                {hits.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={d.id}
                    onSelect={() => {
                      onChange(d)
                      setOpen(false)
                    }}
                  >
                    <CheckIcon className={cn(value?.id === d.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{d.title}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {d.docNumber ?? d.id} · {d.type}
                      </span>
                    </span>
                    <StatusBadge status={d.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** "Add link" Dialog: relate this document `--type-->` another (`POST /api/documents/:id/links`). */
export function AddLinkDialog({ doc }: { doc: DocumentDetail }) {
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState("")
  const [target, setTarget] = React.useState<DocumentSummary | null>(null)
  const [submitted, setSubmitted] = React.useState(false)
  const meta = useMeta()
  const mutation = useLinkDocument(doc.id)
  const types = linkableTypes(meta.data?.relationTypes ?? [])

  function onOpenChange(next: boolean) {
    if (!next && mutation.isPending) return
    if (next) {
      setType("")
      setTarget(null)
      setSubmitted(false)
    }
    setOpen(next)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (!type || !target) return
    try {
      await mutation.mutateAsync({ toId: target.id, type })
      toast.success(`Linked: ${relationLabel(type)} ${target.docNumber ?? target.id}`)
      setOpen(false)
    } catch {
      // Toasted by the query client; the dialog stays open to try again.
    }
  }

  const pending = mutation.isPending
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LinkIcon data-icon="inline-start" />
          Add link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a document</DialogTitle>
          <DialogDescription>Record how {doc.title} relates to another document.</DialogDescription>
        </DialogHeader>
        <form id="add-link" noValidate onSubmit={(e) => void onSubmit(e)}>
          <FieldGroup>
            <Field data-invalid={(submitted && !type) || undefined}>
              <FieldLabel htmlFor="link-type">Relation</FieldLabel>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="link-type" className="w-full" aria-invalid={(submitted && !type) || undefined}>
                  <SelectValue placeholder="Choose a relation" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t} value={t}>{relationLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>This document {type ? relationLabel(type) : "…"} the chosen document.</FieldDescription>
              {submitted && !type ? <FieldError>Pick a relation type</FieldError> : null}
            </Field>
            <Field data-invalid={(submitted && !target) || undefined}>
              <FieldLabel htmlFor="link-target">Document</FieldLabel>
              <DocumentPicker id="link-target" excludeId={doc.id} value={target} onChange={setTarget} invalid={submitted && !target} />
              {submitted && !target ? <FieldError>Pick a document to link</FieldError> : null}
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button type="submit" form="add-link" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Add link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
