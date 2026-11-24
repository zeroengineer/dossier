import type { TemplateLoadError, TemplateNumbering, TemplateSummary } from "@/api/types"

/** Where a row comes from, as shown in the Source column: a workspace override that inherits reads as "inherited". */
export type TemplateOrigin = "builtin" | "workspace" | "inherited"

export const ORIGIN_LABELS: Record<TemplateOrigin, string> = {
  builtin: "Built-in",
  workspace: "Workspace",
  inherited: "Inherited",
}

export function templateOrigin(t: Pick<TemplateSummary, "source" | "inherits">): TemplateOrigin {
  if (t.source === "builtin") return "builtin"
  return t.inherits ? "inherited" : "workspace"
}

export function sourceLabel(source: TemplateLoadError["source"]): string {
  return source === "builtin" ? ORIGIN_LABELS.builtin : ORIGIN_LABELS.workspace
}

/** "letter" -> "Letter". Categories are lower-case ids in template.json. */
export function categoryLabel(category: string): string {
  return category ? category.charAt(0).toUpperCase() + category.slice(1) : category
}

/** "Brand series", or the series id; "(optional)" when the template may be generated without a number. */
export function numberingLabel(numbering: TemplateNumbering | null): string {
  if (!numbering) return "None"
  const series = numbering.series === "brand" ? "Brand series" : numbering.series
  return numbering.required === false ? `${series} (optional)` : series
}
