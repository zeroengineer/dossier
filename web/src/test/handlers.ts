import { http, HttpResponse } from "msw"
import { me, meta } from "./fixtures"

/** Default API handlers; tests override per case with `server.use(...)`. */
export const handlers = [
  http.get("*/api/me", () => HttpResponse.json(me)),
  http.get("*/api/meta", () => HttpResponse.json(meta)),
]
