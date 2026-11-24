import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import type { BrandAssets, BrandAssetUpload, BrandDetail, BrandFile, BrandList, SeriesIdList } from "./types"

/** Query keys under the `brands` prefix (invalidate `brandKeys.all` after any brand write). */
export const brandKeys = {
  all: ["brands"] as const,
  list: ["brands", "list"] as const,
  detail: (id: string) => ["brands", "detail", id] as const,
  assets: (id: string) => ["brands", "assets", id] as const,
  /** Series ids offered in the brand editor's series map (`series` prefix, so a series edit refreshes it). */
  seriesIds: ["series", "brand-editor-ids"] as const,
}

const enc = encodeURIComponent

/** Served URLs of a brand's files. */
export const brandUrls = {
  /** `brand.json` as a download named `<id>.json`. */
  file: (id: string) => `/api/brands/${enc(id)}/file`,
  /** The letterhead preview PDF; `ts` busts the browser cache after a save. */
  preview: (id: string, ts?: string) => `/api/brands/${enc(id)}/preview.pdf${ts ? `?ts=${enc(ts)}` : ""}`,
}

export const fetchBrands = (signal?: AbortSignal) => request<BrandList>("/api/brands", { signal })
export const fetchBrand = (id: string, signal?: AbortSignal) => request<BrandDetail>(`/api/brands/${enc(id)}`, { signal })
export const fetchBrandAssets = (id: string, signal?: AbortSignal) => request<BrandAssets>(`/api/brands/${enc(id)}/assets`, { signal })

/** Every brand with its parent (`GET /api/brands`). */
export function useBrands() {
  return useQuery({ queryKey: brandKeys.list, queryFn: ({ signal }) => fetchBrands(signal) })
}

/** One brand: its own file, the resolved brand and its config hash. `id` "" disables the query. */
export function useBrand(id: string) {
  return useQuery({ queryKey: brandKeys.detail(id), queryFn: ({ signal }) => fetchBrand(id, signal), enabled: id !== "" })
}

/** The asset slots of a brand with their sources and `?v=`-pinned URLs. */
export function useBrandAssets(id: string) {
  return useQuery({ queryKey: brandKeys.assets(id), queryFn: ({ signal }) => fetchBrandAssets(id, signal), enabled: id !== "" })
}

/** Series ids of `series.json`, for the series-map selects. */
export function useSeriesIds() {
  return useQuery({
    queryKey: brandKeys.seriesIds,
    queryFn: ({ signal }) => request<SeriesIdList>("/api/series", { signal }),
    select: (d) => d.series.map((s) => s.id).filter((s): s is string => typeof s === "string"),
  })
}

/** Replace a brand's whole `brand.json` (`PUT /api/brands/:id`; creates it when it does not exist). */
export const putBrand = (id: string, body: BrandFile) => request<BrandDetail>(`/api/brands/${enc(id)}`, { method: "PUT", json: body })

/** Upload one asset slot's file (`POST /api/brands/:id/assets/:key`, multipart `file`). */
export function uploadBrandAsset(id: string, key: string, file: File) {
  const formData = new FormData()
  formData.append("file", file)
  return request<BrandAssetUpload>(`/api/brands/${enc(id)}/assets/${enc(key)}`, { method: "POST", formData })
}

/** After a brand write: refresh brands (list, detail, assets) and `/api/me` (its brand names). */
function useInvalidateBrands() {
  const queryClient = useQueryClient()
  return (detail?: BrandDetail) => {
    if (detail) queryClient.setQueryData(brandKeys.detail(detail.id), detail)
    void queryClient.invalidateQueries({ queryKey: brandKeys.all })
    void queryClient.invalidateQueries({ queryKey: keys.me })
  }
}

export function useSaveBrand(id: string) {
  const invalidate = useInvalidateBrands()
  return useMutation({ mutationFn: (body: BrandFile) => putBrand(id, body), onSuccess: (detail) => invalidate(detail) })
}

/** Create a brand: `PUT` of its first `brand.json` (the caller checks the id is not taken). */
export function useCreateBrand() {
  const invalidate = useInvalidateBrands()
  return useMutation({ mutationFn: (body: BrandFile) => putBrand(body.id, body), onSuccess: (detail) => invalidate(detail) })
}

export function useUploadBrandAsset(id: string) {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: ({ key, file }: { key: string; file: File }) => uploadBrandAsset(id, key, file),
    onSuccess: (r) => invalidate(r.brand),
  })
}
