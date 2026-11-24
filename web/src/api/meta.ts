import { useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { Meta } from "./types"

export const fetchMeta = (signal?: AbortSignal) => request<Meta>("/api/meta", { signal })

/** Enumerations and rules (statuses, transitions, levels, limits). Static for the server's lifetime. */
export function useMeta() {
  return useQuery({ queryKey: keys.meta, queryFn: ({ signal }) => fetchMeta(signal), staleTime: Infinity })
}
