// Numbering series (series.json) and workspace.json: the canonical fetchers and hooks. The upload form's series picker
// and the brand editor's series map read the same `["series", "list"]` query.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { SeriesEntry, SeriesList, SeriesUsage, WorkspaceFile, WorkspaceFileResponse } from "./types"

/** Query keys under the `series` prefix (invalidate `seriesKeys.all` after a series write). */
export const seriesKeys = {
  all: ["series"] as const,
  /** series.json as stored. */
  list: ["series", "list"] as const,
  usage: ["series", "usage"] as const,
}

export const workspaceKeys = {
  all: ["workspace"] as const,
  file: ["workspace", "file"] as const,
}

export const fetchSeries = async (signal?: AbortSignal) => (await request<SeriesList>("/api/series", { signal })).series
export const fetchSeriesUsage = async (signal?: AbortSignal) => (await request<SeriesUsage>("/api/series/usage", { signal })).usage
export const fetchWorkspaceFile = async (signal?: AbortSignal) =>
  (await request<WorkspaceFileResponse>("/api/workspace", { signal })).workspace

/** The workspace's numbering series (series.json as stored), optionally narrowed with `select`. */
export function useSeries<T = SeriesEntry[]>(select?: (list: SeriesEntry[]) => T) {
  return useQuery({ queryKey: seriesKeys.list, queryFn: ({ signal }) => fetchSeries(signal), staleTime: 60_000, select })
}

/** Where each series is used (brand series maps, templates numbering with a series directly). */
export function useSeriesUsage() {
  return useQuery({ queryKey: seriesKeys.usage, queryFn: ({ signal }) => fetchSeriesUsage(signal) })
}

/** workspace.json as stored. */
export function useWorkspaceFile() {
  return useQuery({ queryKey: workspaceKeys.file, queryFn: ({ signal }) => fetchWorkspaceFile(signal) })
}

/** Replace series.json (`PUT /api/series`); answers the stored list. */
export const putSeries = async (series: SeriesEntry[]) =>
  (await request<SeriesList>("/api/series", { method: "PUT", json: { series } })).series

/** Replace workspace.json (`PUT /api/workspace`); answers the stored file. */
export const putWorkspaceFile = async (workspace: WorkspaceFile) =>
  (await request<WorkspaceFileResponse>("/api/workspace", { method: "PUT", json: workspace })).workspace

/**
 * Save series.json. Errors are shown on the form (`silentError`). Afterwards the series queries (list, usage, the
 * brand editor's ids), the dashboard's counters and the templates (their numbering may now load or fail) are refreshed.
 */
export function useSaveSeries() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: putSeries,
    meta: { silentError: true },
    onSuccess: (series) => {
      queryClient.setQueryData(seriesKeys.list, series)
      void queryClient.invalidateQueries({ queryKey: seriesKeys.all })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      void queryClient.invalidateQueries({ queryKey: keys.templates.all })
    },
  })
}

/**
 * Save workspace.json. Its name, default brand and locale feed `/api/me`, and a changed clearance of the acting user
 * changes what every list shows, so every query is refreshed.
 */
export function useSaveWorkspaceFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: putWorkspaceFile,
    meta: { silentError: true },
    onSuccess: (workspace) => {
      queryClient.setQueryData(workspaceKeys.file, workspace)
      void queryClient.invalidateQueries()
    },
  })
}
