import { http, HttpResponse } from "msw"
import { findNode } from "@/features/vault/paths"
import { vaultRoot } from "../fixtures-vault"

/** `GET /api/tree?node=<id>` over the example tree; unknown ids answer 404 NODE_NOT_FOUND like the server. */
export const handlers = [
  http.get("*/api/tree", ({ request }) => {
    const id = (new URL(request.url).searchParams.get("node") ?? "").replace(/^\/+|\/+$/g, "")
    const node = findNode(vaultRoot, id)
    if (!node) return HttpResponse.json({ code: "NODE_NOT_FOUND", message: `No folder ${id}`, details: { id } }, { status: 404 })
    return HttpResponse.json(node)
  }),
]
