import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { DashboardDays, DashboardSummary } from "./types"

export const fetchDashboard = (days: DashboardDays, signal?: AbortSignal) =>
  request<DashboardSummary>("/api/dashboard", { query: { days }, signal })

/** `GET /api/dashboard?days=`. Keeps the previous range on screen while a new one loads. */
export function useDashboard(days: DashboardDays) {
  return useQuery({
    queryKey: keys.dashboard(days),
    queryFn: ({ signal }) => fetchDashboard(days, signal),
    placeholderData: keepPreviousData,
  })
}
