import { z } from "zod"
import type { EntityDetail, EntityInput } from "@/api/types"

/** Select value for "no brand" (Radix Select items cannot have an empty value). */
export const NO_BRAND = "__none__"

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** The attributes textarea: empty means no attributes, anything else must be a JSON object. */
export function parseAttrs(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (text.trim() === "") return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, message: `Attributes are not valid JSON (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!isPlainObject(parsed)) return { ok: false, message: "Attributes must be a JSON object, like {\"email\": \"someone@example.com\"}" }
  return { ok: true, value: parsed }
}

/** Attributes as the textarea shows them: pretty JSON, or empty when there are none. */
export const formatAttrs = (attrs: Record<string, unknown>) => (Object.keys(attrs).length ? JSON.stringify(attrs, null, 2) : "")

export const entityFormSchema = z.object({
  kind: z.string().min(1, "Kind is required"),
  name: z.string().trim().min(1, "Name is required"),
  aliases: z.array(z.string()),
  brand: z.string(),
  attrs: z.string().superRefine((text, ctx) => {
    const r = parseAttrs(text)
    if (!r.ok) ctx.addIssue({ code: "custom", message: r.message })
  }),
})

export type EntityFormValues = z.infer<typeof entityFormSchema>

/** Form values for a new entity (of `kind`) or for editing `entity`. */
export function formValues(entity: EntityDetail | null, kind = ""): EntityFormValues {
  if (!entity) return { kind, name: "", aliases: [], brand: NO_BRAND, attrs: "" }
  return { kind: entity.kind, name: entity.name, aliases: [...entity.aliases], brand: entity.brand ?? NO_BRAND, attrs: formatAttrs(entity.attrs) }
}

/**
 * The `POST /api/entities` body for the form. The server merges attrs and only adds aliases, so when editing, a key
 * removed from the JSON is sent as null (the server deletes it) and the textarea's object becomes the new attrs.
 */
export function toEntityInput(values: EntityFormValues, entity: EntityDetail | null): EntityInput {
  const parsed = parseAttrs(values.attrs)
  const attrs = parsed.ok ? parsed.value : {}
  const aliases = values.aliases.map((a) => a.trim()).filter(Boolean)
  const brand = values.brand === NO_BRAND || values.brand === "" ? null : values.brand
  if (!entity) {
    return {
      kind: values.kind,
      name: values.name.trim(),
      ...(aliases.length ? { aliases } : {}),
      ...(Object.keys(attrs).length ? { attrs } : {}),
      ...(brand ? { brand } : {}),
    }
  }
  const patch: Record<string, unknown> = { ...attrs }
  for (const key of Object.keys(entity.attrs)) if (!Object.hasOwn(attrs, key)) patch[key] = null
  const added = aliases.filter((a) => !entity.aliases.includes(a))
  return {
    id: entity.id,
    name: values.name.trim(),
    ...(added.length ? { aliases: added } : {}),
    ...(Object.keys(patch).length ? { attrs: patch } : {}),
    brand,
  }
}

/** Add `alias` to `list` unless it is blank or already there (case-insensitive). */
export function addAlias(list: string[], alias: string): string[] {
  const text = alias.trim().replace(/\s+/g, " ")
  if (!text || list.some((a) => a.toLowerCase() === text.toLowerCase())) return list
  return [...list, text]
}
