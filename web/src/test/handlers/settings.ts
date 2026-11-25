import { http, HttpResponse } from "msw"
import type { SeriesEntry, WorkspaceFile } from "@/api/types"
import { SERIES_HASH, WORKSPACE_HASH, seriesFile, seriesUsage, workspaceFile } from "../fixtures-settings"

/**
 * Numbering and workspace settings: series.json (the canonical `GET /api/series`, also read by the brand editor and
 * the upload form), its usage, and workspace.json. PUTs echo the body back as the stored file.
 */
export const handlers = [
  http.get("*/api/series", () => HttpResponse.json({ series: seriesFile, fileHash: SERIES_HASH })),
  http.get("*/api/series/usage", () => HttpResponse.json({ usage: seriesUsage })),
  http.put("*/api/series", async ({ request }) => {
    const body = (await request.json()) as { series: SeriesEntry[] }
    return HttpResponse.json({ series: body.series, fileHash: "5e".repeat(32) })
  }),
  http.get("*/api/workspace", () => HttpResponse.json({ workspace: workspaceFile, fileHash: WORKSPACE_HASH })),
  http.put("*/api/workspace", async ({ request }) =>
    HttpResponse.json({ workspace: (await request.json()) as WorkspaceFile, fileHash: "3a".repeat(32) })),
]
