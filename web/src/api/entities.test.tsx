import * as React from "react"
import { QueryClientProvider, type QueryClient, type QueryKey } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import { brandDetails } from "@/test/fixtures-brands"
import { acmeCompany } from "@/test/fixtures-entities"
import { createTestQueryClient } from "@/test/render"
import { server } from "@/test/server"
import { useSaveBrand } from "./brands"
import { usePartyOptions } from "./documents"
import { ENTITY_LIST_LIMIT, fetchEntities, useEntity, useParty, useSaveEntity } from "./entities"
import { useEntityOptions } from "./generate"
import { templateKeys } from "./templates"

function withClient(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** Record every `GET /api/entities` query string while the default handler answers. */
function captureListQueries() {
  const seen: URLSearchParams[] = []
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/api/entities") seen.push(url.searchParams)
  })
  return seen
}

/** Seed `keys` with data and return a reader of whether each was invalidated. */
function seed(queryClient: QueryClient, keys: QueryKey[]) {
  for (const key of keys) queryClient.setQueryData(key, { seeded: true })
  return (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated
}

afterEach(() => {
  server.events.removeAllListeners()
})

describe("entity fetchers (one GET /api/entities fetcher)", () => {
  it("fetchEntities sends kind, q and limit, dropping the ones not given", async () => {
    const seen = captureListQueries()
    const list = await fetchEntities({ kind: "company", q: "acme", limit: 5 })
    expect(list.entities.map((e) => e.name)).toEqual(["Acme Events Private Limited"])
    await fetchEntities({ q: "alex" })
    expect(seen.map((p) => p.toString())).toEqual(["kind=company&q=acme&limit=5", "q=alex"])
  })

  it("the party picker and the generate form's entity options go through it", async () => {
    const seen = captureListQueries()
    const qc = createTestQueryClient()
    const party = renderHook(() => usePartyOptions("acme"), { wrapper: withClient(qc) })
    await waitFor(() => expect(party.result.current.data?.[0]?.name).toBe("Acme Events Private Limited"))
    const options = renderHook(() => useEntityOptions("person"), { wrapper: withClient(qc) })
    await waitFor(() => expect(options.result.current.data?.entities.map((e) => e.name)).toEqual(["Alex Example"]))
    expect(seen.map((p) => p.toString())).toEqual(["q=acme&limit=20", `kind=person&limit=${ENTITY_LIST_LIMIT}`])
  })

  it("useParty and useEntity share the detail key with one response type (EntityDetail)", async () => {
    const qc = createTestQueryClient()
    const party = renderHook(() => useParty(1), { wrapper: withClient(qc) })
    await waitFor(() => expect(party.result.current.data?.name).toBe(acmeCompany.name))
    // The entity page reads the same cache entry at once and gets the full detail, relations included.
    const entity = renderHook(() => useEntity("1"), { wrapper: withClient(qc) })
    expect(entity.result.current.data).toEqual(acmeCompany)
    expect(party.result.current.data).toEqual(acmeCompany)
  })
})

describe("cache invalidation after writes", () => {
  it("saving an entity (rename or edit) refreshes entities, documents, search and the vault tree", async () => {
    const qc = createTestQueryClient()
    const invalidated = seed(qc, [["search", "acme"], ["tree", "node", "03"], ["documents", "list", {}], ["entities", "list", {}], ["dashboard", 30]])
    const { result } = renderHook(() => useSaveEntity(), { wrapper: withClient(qc) })
    await act(() => result.current.mutateAsync({ id: 1, kind: "company", name: "Acme Events Pvt Ltd" }))
    expect(invalidated(["search", "acme"])).toBe(true)
    expect(invalidated(["tree", "node", "03"])).toBe(true)
    expect(invalidated(["documents", "list", {}])).toBe(true)
    expect(invalidated(["entities", "list", {}])).toBe(true)
    expect(invalidated(["dashboard", 30])).toBe(false)
  })

  it("saving a brand refreshes the dashboard and the cached template details", async () => {
    server.use(http.put("*/api/brands/:id", async ({ request }) => HttpResponse.json({ ...brandDetails["acme"], file: await request.json() })))
    const qc = createTestQueryClient()
    const invalidated = seed(qc, [["dashboard", 30], templateKeys.detail("invoice", "acme"), templateKeys.detail("invoice", null), templateKeys.list])
    const { result } = renderHook(() => useSaveBrand("acme"), { wrapper: withClient(qc) })
    await act(() => result.current.mutateAsync({ body: brandDetails["acme"]!.file }))
    expect(invalidated(["dashboard", 30])).toBe(true)
    expect(invalidated(templateKeys.detail("invoice", "acme"))).toBe(true)
    expect(invalidated(templateKeys.detail("invoice", null))).toBe(true)
    expect(invalidated(templateKeys.list)).toBe(false)
  })
})
