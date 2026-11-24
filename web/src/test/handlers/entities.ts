import { http, HttpResponse } from "msw"
import type { EntityDetail, EntityInput } from "@/api/types"
import { entityDetails, summaryOf } from "../fixtures-entities"
import { meta } from "../fixtures"

const error = (status: number, code: string, message: string, details: Record<string, unknown> = {}) =>
  HttpResponse.json({ code, message, details }, { status })

const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

/** The fixture entity owning `name` (as name or alias) within `kind`, like the server's duplicate check. */
const ownerOf = (kind: string, name: string) =>
  entityDetails.find((e) => e.kind === kind && [e.name, ...e.aliases].some((n) => fold(n) === fold(name)))

/**
 * Entity defaults over the fixtures (read-only: writes answer as the server would but change nothing).
 * `GET /api/entities` honours `kind` (unknown → 400), `q` (name or alias substring, case and punctuation folded) and
 * `limit`, like the real route; `GET /api/entities/:id` takes an id or a name; `POST /api/entities` creates (id 99) or
 * updates and reports `ENTITY_DUPLICATE` for a name or alias of another entity of the kind; relations answer 201.
 */
export const handlers = [
  http.get("*/api/entities", ({ request }) => {
    const url = new URL(request.url)
    const kind = url.searchParams.get("kind") ?? ""
    const q = fold(url.searchParams.get("q") ?? "")
    const limit = Number(url.searchParams.get("limit") ?? 50)
    if (kind && !meta.entityKinds.includes(kind)) return error(400, "INVALID_INPUT", `Unknown entity kind "${kind}"`, { kind })
    const entities = entityDetails
      .filter((e) => !kind || e.kind === kind)
      .filter((e) => !q || [e.name, ...e.aliases].some((n) => fold(n).includes(q)))
      .slice(0, limit)
      .map((e) => {
        const s = summaryOf(e)
        const alias = q && !fold(e.name).includes(q) ? e.aliases.find((a) => fold(a).includes(q)) : undefined
        return alias ? { ...s, matched: alias } : s
      })
    return HttpResponse.json({ entities })
  }),

  http.get("*/api/entities/:id", ({ params }) => {
    const ref = String(params["id"])
    const e = /^\d+$/.test(ref) ? entityDetails.find((x) => x.id === Number(ref)) : entityDetails.find((x) => fold(x.name) === fold(ref))
    return e ? HttpResponse.json(e) : error(404, "ENTITY_NOT_FOUND", `No entity matches "${ref}"`, { ref })
  }),

  http.post("*/api/entities", async ({ request }) => {
    const body = (await request.json()) as EntityInput
    const existing = body.id !== undefined ? entityDetails.find((e) => e.id === body.id) : undefined
    if (body.id !== undefined && !existing) return error(404, "ENTITY_NOT_FOUND", `No entity matches "${body.id}"`, { ref: body.id })
    const kind = existing?.kind ?? body.kind ?? ""
    if (!meta.entityKinds.includes(kind)) return error(400, "INVALID_INPUT", `Unknown entity kind "${kind}"`, { kind })
    for (const n of [body.name, ...(body.aliases ?? [])]) {
      const owner = ownerOf(kind, n)
      if (owner && owner.id !== existing?.id) {
        return error(409, "ENTITY_DUPLICATE", `"${n}" already names ${kind} "${owner.name}" (id ${owner.id})`, { existingId: owner.id, kind, name: n })
      }
    }
    const base: EntityDetail = existing ?? {
      id: 99, kind, name: body.name, key: fold(body.name), brand: null, attrs: {}, aliases: [], relations: [], documentCount: 0,
      createdAt: "2026-04-03T09:00:00.000Z", updatedAt: "2026-04-03T09:00:00.000Z",
    }
    const attrs: Record<string, unknown> = { ...base.attrs }
    for (const [k, v] of Object.entries(body.attrs ?? {})) {
      if (v === null) delete attrs[k]
      else attrs[k] = v
    }
    const saved: EntityDetail = {
      ...base,
      name: body.name,
      aliases: [...base.aliases, ...(body.aliases ?? []).filter((a) => !base.aliases.includes(a))],
      attrs,
      brand: body.brand === undefined ? base.brand : body.brand,
    }
    return HttpResponse.json(saved, { status: existing ? 200 : 201 })
  }),

  http.post("*/api/entities/:id/relations", async ({ params, request }) => {
    const { to, role } = (await request.json()) as { to: number; role: string }
    return HttpResponse.json({ id: 50, from: Number(params["id"]), to, role, attrs: {} }, { status: 201 })
  }),
]
