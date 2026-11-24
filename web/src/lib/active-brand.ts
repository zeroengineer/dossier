import { useCallback, useSyncExternalStore } from "react"
import type { Me } from "@/api/types"

const STORAGE_KEY = "dossier.activeBrand"
const listeners = new Set<() => void>()

function read(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function setActiveBrand(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage unavailable (private mode): the choice lasts until reload.
  }
  for (const l of listeners) l()
}

/**
 * The brand the user works under (sidebar switcher; Generate's default brand). The stored id is used when it still
 * names a brand of the workspace, else the workspace's default brand, else the first brand.
 */
export function useActiveBrand(me: Me | undefined) {
  const stored = useSyncExternalStore(subscribe, read, () => null)
  const brands = me?.brands ?? []
  const brand =
    brands.find((b) => b.id === stored)
    ?? brands.find((b) => b.id === me?.workspace.defaultBrand)
    ?? brands[0]
    ?? null
  const select = useCallback((id: string) => setActiveBrand(id), [])
  return { brand, brands, select }
}
