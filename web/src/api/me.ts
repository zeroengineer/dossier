import { useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { Me } from "./types"

export const fetchMe = (signal?: AbortSignal) => request<Me>("/api/me", { signal })

/** The acting user, workspace and brands. Changes only when the workspace is edited, so it is kept fresh for long. */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: ({ signal }) => fetchMe(signal), staleTime: 5 * 60_000 })
}
