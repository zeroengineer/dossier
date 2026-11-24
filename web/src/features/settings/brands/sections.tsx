// The brand editor's tabs (except Assets): one card per section, bound to the editor's form.
import type * as React from "react"
import { Link } from "react-router"
import { Controller, useWatch, type FieldPath, type UseFormReturn } from "react-hook-form"
import type { BrandFile } from "@/api/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldGroup, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { SelectField, TextField } from "../form-fields"
import { fallbackOf, parentValue, type BrandContext, type BrandFormValues, type MapRow, type OverridableList } from "./brand-form"
import { OverrideSwitch, RowsEditor, type RowColumn } from "./rows-editor"

export interface SectionProps {
  form: UseFormReturn<BrandFormValues>
  /** The stored brand.json the form was loaded from. */
  file: BrandFile
  ctx: BrandContext
  /** Id of the brand this one inherits from, or null. */
  parentId: string | null
}

type Name = FieldPath<BrandFormValues>

const text = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? v.join("\n") : v === undefined || v === null ? "" : String(v))

export function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <FieldGroup>{children}</FieldGroup>
      </CardContent>
    </Card>
  )
}

/** Placeholder of a scalar: the inherited value for an inheriting brand. */
const inheritedPlaceholder = ({ parentId, ctx }: SectionProps, path: string) => (parentId ? text(parentValue(ctx, path)) : undefined)

function ParentLink({ parentId }: { parentId: string }) {
  return (
    <Link to={`/settings/brands/${encodeURIComponent(parentId)}`} className="font-medium underline-offset-4 hover:underline">
      {parentId}
    </Link>
  )
}

/** Signatory ids of the list being edited (the inherited ones while the list is not overridden). */
function useSignatoryOptions(form: SectionProps["form"], blank: string) {
  const rows = useWatch({ control: form.control, name: "signatories.rows" })
  const ids = [...new Set((rows ?? []).map((r) => r.id.trim()).filter(Boolean))]
  return [{ value: "", label: blank }, ...ids.map((s) => ({ value: s, label: s }))]
}

export function IdentitySection(p: SectionProps) {
  const { form, parentId, ctx } = p
  const required = parentId ? "" : " *"
  const contactOptions = useSignatoryOptions(form, parentId && ctx.parent?.projectContact ? `Inherit (${ctx.parent.projectContact})` : "None")
  return (
    <Section
      title="Identity"
      description={parentId ? <>Inherits from <ParentLink parentId={parentId} />. Blank fields use the inherited value shown in grey.</> : "The names printed on documents."}
    >
      <TextField control={form.control} name="legalName" label={`Legal name${required}`} placeholder={inheritedPlaceholder(p, "legalName")} />
      <TextField control={form.control} name="shortName" label={`Short name${required}`} placeholder={inheritedPlaceholder(p, "shortName")} />
      <SelectField
        control={form.control}
        name="projectContact"
        label="Project contact"
        description="The signatory printed as the project contact in proposal sign-offs."
        options={contactOptions}
      />
    </Section>
  )
}

export function AddressesSection(p: SectionProps) {
  const { form, parentId } = p
  return (
    <Section title="Addresses" description="One line per row.">
      <TextField
        control={form.control}
        name="addresses.business"
        label={`Business address${parentId ? "" : " *"}`}
        multiline
        rows={4}
        placeholder={inheritedPlaceholder(p, "addresses.business")}
      />
      <TextField
        control={form.control}
        name="addresses.registered"
        label="Registered address"
        description="Optional."
        multiline
        rows={4}
        placeholder={inheritedPlaceholder(p, "addresses.registered")}
      />
    </Section>
  )
}

interface ListSectionProps extends SectionProps {
  title: string
  description?: React.ReactNode
  /** The overridable list (`registrations`, `bankAccounts`, `letterhead`, `signatories`, `tax.modes`). */
  list: "registrations" | "bankAccounts" | "letterhead" | "signatories" | "tax.modes"
  columns: RowColumn[]
  blank: Record<string, string>
  rowLabel: (i: number) => string
  addLabel: string
  gridColumns?: number
  children?: React.ReactNode
}

/** A list section; for an inheriting brand, with the override switch (read-only while it is off). */
function ListSection({ form, parentId, title, description, list, columns, blank, rowLabel, addLabel, gridColumns, children }: ListSectionProps) {
  const value = useWatch({ control: form.control, name: list }) as OverridableList<unknown>
  const editable = !parentId || value.override
  return (
    <Section title={title} description={description}>
      {parentId ? <OverrideSwitch control={form.control} name={`${list}.override` as Name} parentId={parentId} /> : null}
      <RowsEditor
        control={form.control}
        name={`${list}.rows` as `registrations.rows`}
        columns={columns}
        blank={blank}
        rowLabel={rowLabel}
        addLabel={addLabel}
        disabled={!editable}
        gridColumns={gridColumns}
      />
      {children}
    </Section>
  )
}

export function RegistrationsSection(p: SectionProps) {
  return (
    <ListSection
      {...p}
      title="Registrations"
      description="Printed where templates list registration numbers; use {registrations.0.value} in letterhead lines."
      list="registrations"
      columns={[{ key: "label", label: "Label", placeholder: "CIN" }, { key: "value", label: "Value" }]}
      blank={{ label: "", value: "" }}
      rowLabel={(i) => `registration ${i + 1}`}
      addLabel="Add registration"
    />
  )
}

export function BankSection(p: SectionProps) {
  return (
    <ListSection
      {...p}
      title="Bank accounts"
      list="bankAccounts"
      columns={[
        { key: "accountName", label: "Account name" },
        { key: "bankName", label: "Bank" },
        { key: "accountNumber", label: "Account number" },
        { key: "ifsc", label: "IFSC" },
        { key: "swift", label: "SWIFT" },
        { key: "branch", label: "Branch" },
      ]}
      blank={{ accountName: "", bankName: "", accountNumber: "", ifsc: "", swift: "", branch: "" }}
      rowLabel={(i) => `bank account ${i + 1}`}
      addLabel="Add bank account"
      gridColumns={3}
    />
  )
}

export function LetterheadSection(p: SectionProps) {
  return (
    <ListSection
      {...p}
      title="Letterhead"
      description="Lines under the logo. Placeholders such as {contact.email}, {legalName} and {strings.confidential} are filled when a document is rendered."
      list="letterhead"
      columns={[{ key: "value", label: "Line" }]}
      blank={{ value: "" }}
      rowLabel={(i) => `letterhead line ${i + 1}`}
      addLabel="Add line"
    />
  )
}

export function FooterSection(p: SectionProps) {
  const { form } = p
  return (
    <Section title="Footer" description="Placeholders such as {contact.email}, {page} and {pages} are filled when a document is rendered.">
      <TextField control={form.control} name="footer.left" label="Left" placeholder={inheritedPlaceholder(p, "footer.left")} />
      <TextField control={form.control} name="footer.center" label="Centre" placeholder={inheritedPlaceholder(p, "footer.center")} />
      <TextField control={form.control} name="footer.right" label="Right" placeholder={inheritedPlaceholder(p, "footer.right")} />
    </Section>
  )
}

/** Inherited map entries this brand does not set itself (they merge key by key). */
function InheritedEntries({ form, parentId, ctx, name, show }: SectionProps & { name: "contacts" | "defaultSignatory" | "strings" | "series"; show?: (v: unknown) => string }) {
  const rows = useWatch({ control: form.control, name }) as Array<{ key: string }>
  if (!parentId || !ctx.parent) return null
  const mine = new Set(rows.map((r) => r.key.trim()))
  const parentMap = ctx.parent[name] as Record<string, unknown>
  const rest = Object.entries(parentMap ?? {}).filter(([k]) => !mine.has(k))
  if (!rest.length) return null
  const fmt = show ?? ((v: unknown) => (typeof v === "string" ? v : JSON.stringify(v)))
  return (
    <div className="flex flex-col gap-2">
      <FieldSeparator>Inherited from {parentId}</FieldSeparator>
      <Table aria-label={`Inherited ${name}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rest.map(([k, v]) => (
            <TableRow key={k}>
              <TableCell className="font-mono text-xs">{k}</TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">{fmt(v)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ContactsSection(p: SectionProps) {
  return (
    <Section
      title="Contacts"
      description={p.parentId ? "Contacts merge with the inherited ones key by key; add a key to override it." : 'A "default" contact is required; others (hr, billing…) fall back to it per field.'}
    >
      <RowsEditor
        control={p.form.control}
        name="contacts"
        columns={[
          { key: "key", label: "Key", placeholder: "default" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "website", label: "Website" },
        ]}
        blank={{ key: "", email: "", phone: "", website: "" }}
        rowLabel={(i) => `contact ${i + 1}`}
        addLabel="Add contact"
      />
      <InheritedEntries {...p} name="contacts" show={(c) => Object.values(c as Record<string, string>).join(", ")} />
    </Section>
  )
}

function MapSection(p: SectionProps & { title: string; description?: React.ReactNode; name: "strings" | "series"; columns: RowColumn[]; rowLabel: (i: number) => string; addLabel: string }) {
  const { form, title, description, name, columns, rowLabel, addLabel } = p
  return (
    <Section title={title} description={description}>
      <RowsEditor control={form.control} name={name} columns={columns} blank={{ key: "", value: "" } satisfies MapRow} rowLabel={rowLabel} addLabel={addLabel} />
      <InheritedEntries {...p} name={name} />
    </Section>
  )
}

export function StringsSection(p: SectionProps) {
  return (
    <MapSection
      {...p}
      title="Strings"
      description="Free text used by templates (confidential, invoiceDeclaration, thankYou, forCompany…); placeholders allowed."
      name="strings"
      columns={[{ key: "key", label: "Key", placeholder: "confidential" }, { key: "value", label: "Text", multiline: true }]}
      rowLabel={(i) => `string ${i + 1}`}
      addLabel="Add string"
    />
  )
}

export function SeriesSection(p: SectionProps & { seriesIds: string[] }) {
  return (
    <MapSection
      {...p}
      title="Numbering series"
      description={<>The series each template numbers its documents with. Series are defined on the <Link to="/settings/numbering" className="underline underline-offset-4">Numbering</Link> page.</>}
      name="series"
      columns={[
        { key: "key", label: "Template id", placeholder: "invoice" },
        { key: "value", label: "Series", options: [{ value: "", label: "—" }, ...p.seriesIds.map((s) => ({ value: s, label: s }))] },
      ]}
      rowLabel={(i) => `series entry ${i + 1}`}
      addLabel="Add template"
    />
  )
}

export function SignatoriesSection(p: SectionProps) {
  const options = useSignatoryOptions(p.form, "—")
  return (
    <>
      <ListSection
        {...p}
        title="Signatories"
        description="People who sign documents. Upload their signature images on the Assets tab."
        list="signatories"
        columns={[
          { key: "id", label: "Id", placeholder: "md" },
          { key: "name", label: "Name" },
          { key: "title", label: "Title" },
          { key: "titleLong", label: "Long title" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "signature", label: "Signature image" },
          { key: "signatureLarge", label: "Large signature image" },
        ]}
        blank={{ id: "", name: "", title: "", titleLong: "", email: "", phone: "", signature: "", signatureLarge: "" }}
        rowLabel={(i) => `signatory ${i + 1}`}
        addLabel="Add signatory"
      />
      <Section title="Default signatory" description="The signatory used per template or category when a document does not name one.">
        <RowsEditor
          control={p.form.control}
          name="defaultSignatory"
          columns={[{ key: "key", label: "Template or category", placeholder: "invoice" }, { key: "value", label: "Signatory", options }]}
          blank={{ key: "", value: "" }}
          rowLabel={(i) => `default signatory ${i + 1}`}
          addLabel="Add default"
        />
        <InheritedEntries {...p} name="defaultSignatory" />
      </Section>
    </>
  )
}

export function TaxSection(p: SectionProps) {
  const { form, parentId, ctx } = p
  const rows = useWatch({ control: form.control, name: "tax.modes.rows" })
  const ids = [...new Set((rows ?? []).map((r) => r.id.trim()).filter(Boolean))]
  const blankLabel = parentId ? `Inherit (${ctx.parent?.tax.defaultMode ?? ""})` : "Default (none)"
  return (
    <ListSection
      {...p}
      title="Tax modes"
      description='Rates are one "label = 0.09" or "label = 9%" per line.'
      list="tax.modes"
      columns={[
        { key: "id", label: "Id", placeholder: "igst" },
        { key: "label", label: "Label" },
        { key: "rates", label: "Rates", multiline: true },
      ]}
      blank={{ id: "", label: "", rates: "" }}
      rowLabel={(i) => `tax mode ${i + 1}`}
      addLabel="Add tax mode"
    >
      <FieldSeparator />
      <SelectField control={form.control} name="tax.defaultMode" label="Default mode" options={[{ value: "", label: blankLabel }, ...ids.map((m) => ({ value: m, label: m }))]} />
      <TextField control={form.control} name="tax.defaultHsn" label="Default HSN/SAC" placeholder={inheritedPlaceholder(p, "tax.defaultHsn")} />
    </ListSection>
  )
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

export function PaletteSection({ form, parentId }: SectionProps) {
  const rows = useWatch({ control: form.control, name: "palette" })
  return (
    <Section
      title="Palette"
      description={`Colours used by the templates. Tick "${parentId ? "Inherit" : "Default"}" to use the ${parentId ? "inherited" : "default"} colour; editing a colour unticks it.`}
    >
      <Table aria-label="Palette">
        <TableHeader>
          <TableRow>
            <TableHead>Colour</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>{parentId ? "Inherit" : "Default"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={row.key}>
              <TableCell className="font-mono text-xs">{row.key}</TableCell>
              <TableCell>
                <Controller
                  control={form.control}
                  name={`palette.${i}.value`}
                  render={({ field, fieldState }) => {
                    const change = (v: string) => {
                      field.onChange(v)
                      form.setValue(`palette.${i}.useDefault`, false, { shouldDirty: true })
                    }
                    return (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Input
                            type="color"
                            aria-label={`${row.key} colour picker`}
                            value={HEX6.test(field.value) ? field.value.toLowerCase() : "#000000"}
                            onChange={(e) => change(e.target.value)}
                            className="size-8 shrink-0 cursor-pointer p-0.5"
                          />
                          <Input
                            ref={field.ref}
                            aria-label={`${row.key} colour`}
                            value={field.value}
                            onChange={(e) => change(e.target.value)}
                            onBlur={field.onBlur}
                            aria-invalid={fieldState.invalid || undefined}
                            className={cn("w-32 font-mono", row.useDefault && "text-muted-foreground")}
                          />
                        </div>
                        {fieldState.error ? <p role="alert" className="text-sm text-destructive">{fieldState.error.message}</p> : null}
                      </div>
                    )
                  }}
                />
              </TableCell>
              <TableCell>
                <Controller
                  control={form.control}
                  name={`palette.${i}.useDefault`}
                  render={({ field }) => (
                    <Checkbox
                      aria-label={`${parentId ? "Inherit" : "Default"} ${row.key}`}
                      checked={field.value}
                      onCheckedChange={(c) => field.onChange(c === true)}
                    />
                  )}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )
}

export function FontsSection({ form, file, ctx, parentId, builtinFonts }: SectionProps & { builtinFonts: string[] }) {
  return (
    <Section title="Fonts" description="A bundled font per weight, or upload a .ttf or .otf file on the Assets tab (the uploaded file is selected automatically).">
      {ctx.fontWeights.map((w) => {
        const fallback = text(fallbackOf(file, ctx, `fonts.${w}`))
        const blank = `${parentId ? "Inherit" : "Default"}${fallback ? ` (${fallback})` : ""}`
        return (
          <SelectField
            key={w}
            control={form.control}
            name={`fonts.${w}`}
            label={w}
            options={[{ value: "", label: blank }, ...builtinFonts.map((f) => ({ value: f, label: f }))]}
          />
        )
      })}
    </Section>
  )
}

export function AdvancedSection({ form }: SectionProps) {
  return (
    <Section
      title="Advanced"
      description="The other keys of brand.json (layoutProfiles, templateParams and any custom keys) as JSON. They are saved with the rest of the form."
    >
      <TextField control={form.control} name="advanced" label="Other keys (JSON object)" multiline rows={16} inputClassName="font-mono text-xs" />
    </Section>
  )
}
