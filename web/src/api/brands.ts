import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { request } from "@/lib/api"
import { keys } from "@/lib/keys"
import { ifMatch, useSeries } from "./settings"
import type { BrandAssets, BrandAssetUpload, BrandDetail, BrandFile, BrandList, SeriesEntry } from "./types"

/** Query keys under the `brands` prefix (invalidate `brandKeys.all` after any brand write). */
export const brandKeys = {
  all: ["brands"] as const,
  list: ["brands", "list"] as const,
  detail: (id: string) => ["brands", "detail", id] as const,
  assets: (id: string) => ["brands", "assets", id] as const,
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

/** One brand: its own file (and its file hash), the resolved brand and its config hash. `id` "" disables the query. */
export function useBrand(id: string) {
  return useQuery({ queryKey: brandKeys.detail(id), queryFn: ({ signal }) => fetchBrand(id, signal), enabled: id !== "" })
}

/** Fetch a brand again (a save was refused because brand.json changed elsewhere) and update the cache. */
export function useReloadBrand(id: string) {
  const queryClient = useQueryClient()
  return () => queryClient.fetchQuery({ queryKey: brandKeys.detail(id), queryFn: ({ signal }) => fetchBrand(id, signal), staleTime: 0 })
}

/** The asset slots of a brand with their sources and `?v=`-pinned URLs. */
export function useBrandAssets(id: string) {
  return useQuery({ queryKey: brandKeys.assets(id), queryFn: ({ signal }) => fetchBrandAssets(id, signal), enabled: id !== "" })
}

const seriesIdsOf = (list: SeriesEntry[]) => list.map((s) => s.id).filter((s): s is string => typeof s === "string")

/** Series ids of `series.json`, for the series-map selects (the canonical series query, narrowed). */
export function useSeriesIds() {
  return useSeries(seriesIdsOf)
}

/**
 * Replace a brand's whole `brand.json` (`PUT /api/brands/:id`; creates it when it does not exist). With `fileHash` (the
 * hash the editor loaded) a brand.json changed elsewhere is refused with 409 CONFLICT.
 */
export const putBrand = (id: string, body: BrandFile, fileHash?: string | null) =>
  request<BrandDetail>(`/api/brands/${enc(id)}`, { method: "PUT", json: body, headers: ifMatch(fileHash) })

/** Upload one asset slot's file (`POST /api/brands/:id/assets/:key`, multipart `file`). */
export function uploadBrandAsset(id: string, key: string, file: File) {
  const formData = new FormData()
  formData.append("file", file)
  return request<BrandAssetUpload>(`/api/brands/${enc(id)}/assets/${enc(key)}`, { method: "POST", formData })
}

/**
 * After a brand write: refresh brands (list, detail, assets), `/api/me` (its brand names), the dashboard (brand names
 * and series) and the cached template details (their form fields can come from a brand's lists; one key per brand,
 * and a child brand or the default brand resolve through this one, so every detail is refreshed).
 */
function useInvalidateBrands() {
  const queryClient = useQueryClient()
  return (detail?: BrandDetail) => {
    if (detail) queryClient.setQueryData(brandKeys.detail(detail.id), detail)
    void queryClient.invalidateQueries({ queryKey: brandKeys.all })
    void queryClient.invalidateQueries({ queryKey: keys.me })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    void queryClient.invalidateQueries({ queryKey: [...keys.templates.all, "detail"] })
  }
}

/** Save brand.json. Errors are shown on the form (`silentError`). */
export function useSaveBrand(id: string) {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: ({ body, fileHash }: { body: BrandFile; fileHash?: string | null }) => putBrand(id, body, fileHash),
    meta: { silentError: true },
    onSuccess: (detail) => invalidate(detail),
  })
}

/** Create a brand (`POST /api/brands`): never overwrites; an existing id is BRAND_DUPLICATE (409). */
export const createBrand = (body: BrandFile) => request<BrandDetail>("/api/brands", { method: "POST", json: body })

/** Create a brand. Errors (BRAND_DUPLICATE …) are shown by the dialog (`silentError`). */
export function useCreateBrand() {
  const invalidate = useInvalidateBrands()
  return useMutation({ mutationFn: createBrand, meta: { silentError: true }, onSuccess: (detail) => invalidate(detail) })
}

/** Upload an asset; the answer carries brand.json's new file hash. Errors are shown by the assets section (`silentError`). */
export function useUploadBrandAsset(id: string) {
  const invalidate = useInvalidateBrands()
  return useMutation({
    mutationFn: ({ key, file }: { key: string; file: File }) => uploadBrandAsset(id, key, file),
    meta: { silentError: true },
    onSuccess: (r) => invalidate(r.brand),
  })
}
