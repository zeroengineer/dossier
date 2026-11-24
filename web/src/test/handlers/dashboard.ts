import { http, HttpResponse } from "msw"
import type { DashboardDays } from "@/api/types"
import { dashboardFixture } from "../fixtures-dashboard"

/** `GET /api/dashboard?days=7|30|90` with the example workspace's figures. */
export const handlers = [
  http.get("*/api/dashboard", ({ request }) => {
    const raw = new URL(request.url).searchParams.get("days") ?? "30"
    const days = Number(raw)
    if (![7, 30, 90].includes(days)) {
      return HttpResponse.json(
        { code: "INVALID_INPUT", message: "days must be one of 7, 30, 90", details: { days: raw, allowed: [7, 30, 90] } },
        { status: 400 },
      )
    }
    return HttpResponse.json(dashboardFixture(days as DashboardDays))
  }),
]
