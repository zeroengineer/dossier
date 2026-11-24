import { useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { TemplateList } from "./types"

/** List key under the `templates` prefix, so invalidating `keys.templates.all` refreshes it. */
export const templateKeys = {
  list: [...keys.templates.all, "list"] as const,
}

export const fetchTemplates = (signal?: AbortSignal) => request<TemplateList>("/api/templates", { signal })

/** Every loadable template plus the template folders that failed to load. */
export function useTemplates() {
  return useQuery({ queryKey: templateKeys.list, queryFn: ({ signal }) => fetchTemplates(signal) })
}
