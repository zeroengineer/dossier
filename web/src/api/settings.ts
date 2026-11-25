// Numbering series (series.json) and workspace.json: the canonical fetchers and hooks. The upload form's series picker
// and the brand editor's series map read the same `["series", "list"]` query.
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { SeriesEntry, SeriesList, SeriesUsage, WorkspaceFile, WorkspaceFileResponse } from "./types"

/** Query keys under the `series` prefix (invalidate `seriesKeys.all` after a series write). */
export const seriesKeys = {
  all: ["series"] as const,
  /** series.json as stored, with its file hash (`SeriesList`). */
  list: ["series", "list"] as const,
  usage: ["series", "usage"] as const,
}

export const workspaceKeys = {
  all: ["workspace"] as const,
  file: ["workspace", "file"] as const,
}

/** `If-Match` for a whole-file save: the file hash the editor loaded (none: the server does not check). */
export const ifMatch = (fileHash: string | null | undefined): Record<string, string> | undefined =>
  fileHash ? { "If-Match": `"${fileHash}"` } : undefined

/** series.json as stored, with its file hash. */
export const fetchSeriesFile = (signal?: AbortSignal) => request<SeriesList>("/api/series", { signal })
export const fetchSeriesUsage = async (signal?: AbortSignal) => (await request<SeriesUsage>("/api/series/usage", { signal })).usage
/** workspace.json as stored, with its file hash. */
export const fetchWorkspaceFile = (signal?: AbortSignal) => request<WorkspaceFileResponse>("/api/workspace", { signal })

const seriesQuery = { queryKey: seriesKeys.list, queryFn: ({ signal }: { signal?: AbortSignal }) => fetchSeriesFile(signal), staleTime: 60_000 }

/** series.json as stored with its file hash (the numbering editor). */
export function useSeriesFile() {
  return useQuery(seriesQuery)
}

/** The workspace's numbering series (series.json as stored), optionally narrowed with `select`. */
export function useSeries<T = SeriesEntry[]>(select?: (list: SeriesEntry[]) => T) {
  const pick = React.useCallback((d: SeriesList) => (select ? select(d.series) : (d.series as T)), [select])
  return useQuery({ ...seriesQuery, select: pick })
}

/** Fetch series.json again (a save was refused because it changed elsewhere) and update the cache. */
export function useReloadSeriesFile() {
  const queryClient = useQueryClient()
  return () => queryClient.fetchQuery({ ...seriesQuery, staleTime: 0 })
}

/** Where each series is used (brand series maps, templates numbering with a series directly). */
export function useSeriesUsage() {
  return useQuery({ queryKey: seriesKeys.usage, queryFn: ({ signal }) => fetchSeriesUsage(signal) })
}

const workspaceQuery = { queryKey: workspaceKeys.file, queryFn: ({ signal }: { signal?: AbortSignal }) => fetchWorkspaceFile(signal) }

/** workspace.json as stored, with its file hash. */
export function useWorkspaceFile() {
  return useQuery(workspaceQuery)
}

/** Fetch workspace.json again (a save was refused because it changed elsewhere) and update the cache. */
export function useReloadWorkspaceFile() {
  const queryClient = useQueryClient()
  return () => queryClient.fetchQuery({ ...workspaceQuery, staleTime: 0 })
}

/**
 * Replace series.json (`PUT /api/series`); answers the stored list and its new hash. With `fileHash` (the hash the
 * editor loaded) a file changed elsewhere is refused with 409 CONFLICT.
 */
export const putSeries = ({ series, fileHash }: { series: SeriesEntry[]; fileHash?: string | null }) =>
  request<SeriesList>("/api/series", { method: "PUT", json: { series }, headers: ifMatch(fileHash) })

/** Replace workspace.json (`PUT /api/workspace`); answers the stored file and its new hash (409 CONFLICT as putSeries). */
export const putWorkspaceFile = ({ workspace, fileHash }: { workspace: WorkspaceFile; fileHash?: string | null }) =>
  request<WorkspaceFileResponse>("/api/workspace", { method: "PUT", json: workspace, headers: ifMatch(fileHash) })

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
