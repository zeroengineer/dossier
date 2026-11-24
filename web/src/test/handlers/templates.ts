import { http, HttpResponse } from "msw"
import { templateList } from "../fixtures-templates"

/** `GET /api/templates`: three templates (built-in, inherited override, workspace) and one load error. */
export const handlers = [http.get("*/api/templates", () => HttpResponse.json(templateList))]
