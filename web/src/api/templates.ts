import { useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { TemplateDetail, TemplateList } from "./types"

/** List key under the `templates` prefix, so invalidating `keys.templates.all` refreshes it. */
export const templateKeys = {
  list: [...keys.templates.all, "list"] as const,
  /** One entry per brand: enum choices can come from the brand's lists. */
  detail: (id: string, brandId: string | null) => [...keys.templates.detail(id), { brandId }] as const,
}

export const fetchTemplates = (signal?: AbortSignal) => request<TemplateList>("/api/templates", { signal })

/** Every loadable template plus the template folders that failed to load. */
export function useTemplates() {
  return useQuery({ queryKey: templateKeys.list, queryFn: ({ signal }) => fetchTemplates(signal) })
}

export const fetchTemplate = (id: string, brandId: string | null, signal?: AbortSignal) => {
  const q = brandId ? `?${new URLSearchParams({ brandId })}` : ""
  return request<TemplateDetail>(`/api/templates/${encodeURIComponent(id)}${q}`, { signal })
}

/**
 * One template with its form fields for `brandId` (the workspace's default brand when null). The previous brand's
 * fields stay on screen while another brand's load, so switching brands does not unmount the form.
 */
export function useTemplate(id: string, brandId: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: templateKeys.detail(id, brandId),
    queryFn: ({ signal }) => fetchTemplate(id, brandId, signal),
    enabled,
    placeholderData: (prev) => (prev?.id === id ? prev : undefined),
  })
}
