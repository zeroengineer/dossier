import { http, HttpResponse } from "msw"
import { searchResult } from "../fixtures-search"

/** `GET /api/search`: the fixture result for any query. */
export const handlers = [http.get("*/api/search", () => HttpResponse.json(searchResult))]
