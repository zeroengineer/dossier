import { http, HttpResponse } from "msw"
import { me, meta } from "../fixtures"

/** Shell-wide defaults: `/api/me` and `/api/meta`. */
export const handlers = [
  http.get("*/api/me", () => HttpResponse.json(me)),
  http.get("*/api/meta", () => HttpResponse.json(meta)),
]
