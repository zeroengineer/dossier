import { http, HttpResponse } from "msw"
import type { BrandDetail, BrandFile } from "@/api/types"
import { acmeAssets, brandDetails, brandList, seriesIds } from "../fixtures-brands"

const notFound = (id: string) => HttpResponse.json({ code: "BRAND_NOT_FOUND", message: `No brand "${id}" in the workspace`, details: { brandId: id } }, { status: 404 })

/** Brand settings: list, detail, assets, series ids; PUT echoes the body back as the new file. */
export const handlers = [
  http.get("*/api/brands", () => HttpResponse.json(brandList)),
  http.get("*/api/brands/:id", ({ params }) => {
    const detail = brandDetails[String(params["id"])]
    return detail ? HttpResponse.json(detail) : notFound(String(params["id"]))
  }),
  http.get("*/api/brands/:id/assets", ({ params }) => {
    const id = String(params["id"])
    if (!brandDetails[id]) return notFound(id)
    return HttpResponse.json({ assets: acmeAssets.assets.map((a) => ({ ...a, url: a.url.replace("/acme/", `/${id}/`) })) })
  }),
  http.put("*/api/brands/:id", async ({ params, request }) => {
    const id = String(params["id"])
    const body = (await request.json()) as BrandFile
    const before = brandDetails[id]
    const detail: BrandDetail = {
      id,
      file: body,
      resolved: before ? before.resolved : { ...brandDetails["acme"]!.resolved, id },
      configHash: "cccccccccccc3333333333333333",
    }
    return HttpResponse.json(detail, { status: before ? 200 : 201 })
  }),
  http.get("*/api/series", () => HttpResponse.json(seriesIds)),
]
