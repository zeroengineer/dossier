import type { DocumentDetail, DocumentRendition, DocumentVersion, RenditionKind } from "@/api/types"

/** Viewer tab order: generated renditions first, then an uploaded original. */
export const VIEWER_KINDS: readonly RenditionKind[] = ["pdf", "html", "md", "original"]

export const KIND_LABEL: Record<RenditionKind, string> = {
  pdf: "PDF",
  html: "HTML",
  md: "Markdown",
  original: "Original",
}

/**
 * The version the viewer shows: `requested` when the document has it, else the current version, else the newest
 * (null when the document has no versions at all).
 */
export function pickVersion(doc: Pick<DocumentDetail, "versions">, requested: number | null): DocumentVersion | null {
  if (requested !== null) {
    const hit = doc.versions.find((v) => v.versionNo === requested)
    if (hit) return hit
  }
  return doc.versions.find((v) => v.isCurrent) ?? doc.versions.at(-1) ?? null
}

/** The version's renditions in viewer order (unknown kinds are left out). */
export function viewerRenditions(version: DocumentVersion | null): DocumentRendition[] {
  if (!version) return []
  return VIEWER_KINDS.flatMap((kind) => version.renditions.filter((r) => r.kind === kind))
}

/** `?version=` from the URL as a positive integer, or null. */
export function parseVersionParam(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return n > 0 ? n : null
}

/** How an original (uploaded) file can be shown inline. */
export function originalPreview(mime: string): "pdf" | "html" | "image" | "text" | null {
  const type = mime.toLowerCase().split(";")[0]?.trim() ?? ""
  if (type === "application/pdf") return "pdf"
  if (type === "text/html") return "html"
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("text/")) return "text"
  return null
}

/** `1.2 MB`-style size, base 1024. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}
