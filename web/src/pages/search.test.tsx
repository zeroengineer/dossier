import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { emptySearchResult, searchResult } from "@/test/fixtures-search"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

/** Record every `/api/search` request URL while answering with `body`. */
function recordSearches(body = searchResult) {
  const urls: URL[] = []
  server.use(
    http.get("*/api/search", ({ request }) => {
      urls.push(new URL(request.url))
      return HttpResponse.json(body)
    }),
  )
  return urls
}

const section = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) })

describe("SearchPage", () => {
  it("asks for a query and does not search without one", async () => {
    const urls = recordSearches()
    renderApp("/search")
    expect(await screen.findByText("Search your workspace")).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search query" })).toHaveValue("")
    expect(urls).toHaveLength(0)
  })

  it("renders the Matched, Related and Entities sections for ?q=", async () => {
    const urls = recordSearches()
    renderApp("/search?q=acme")
    await screen.findByRole("heading", { level: 2, name: "Matched" })
    expect(urls[0]?.searchParams.get("q")).toBe("acme")
    expect(screen.getByRole("searchbox", { name: "Search query" })).toHaveValue("acme")

    const matched = section("Matched")
    expect(within(matched).getByRole("link", { name: /ACM-2026-0007.*Event services invoice/ })).toHaveAttribute("href", "/documents/DOC-000001")
    const mark = matched.querySelector("mark")
    expect(mark).toHaveTextContent("Acme")
    expect(within(matched).getByText("Text")).toBeInTheDocument()
    expect(within(matched).getByText("Number")).toBeInTheDocument()

    const related = section("Related")
    expect(within(related).getByRole("link", { name: /Event services quote/ })).toHaveAttribute("href", "/documents/DOC-000002")
    expect(within(related).getByText("Via quote_for · DOC-000001")).toBeInTheDocument()
    expect(within(related).getByText("Via party of Acme Client Co")).toBeInTheDocument()

    const entities = section("Entities")
    expect(within(entities).getByRole("link", { name: /Alex Example/ })).toHaveAttribute("href", "/entities/7")
    expect(within(entities).getByText("Matched alias “Acme contact”")).toBeInTheDocument()
  })

  it("puts a submitted query in the URL", async () => {
    recordSearches()
    const { user, router } = renderApp("/search")
    const box = await screen.findByRole("searchbox", { name: "Search query" })
    await user.type(box, "  venue {Enter}")
    await waitFor(() => expect(router.state.location.search).toBe("?q=venue"))
    expect(await screen.findByRole("heading", { level: 2, name: "Matched" })).toBeInTheDocument()
  })

  it("shows an empty state when nothing matches", async () => {
    recordSearches(emptySearchResult)
    renderApp("/search?q=nothing")
    expect(await screen.findByText("No results for “nothing”")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: /^Matched/ })).not.toBeInTheDocument()
  })

  it("shows a skeleton, not the old empty state, while the next query loads", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    server.use(
      http.get("*/api/search", async ({ request }) => {
        if (new URL(request.url).searchParams.get("q") === "nothing") return HttpResponse.json(emptySearchResult)
        await gate
        return HttpResponse.json(searchResult)
      }),
    )
    const { user } = renderApp("/search?q=nothing")
    expect(await screen.findByText("No results for “nothing”")).toBeInTheDocument()
    const box = screen.getByRole("searchbox", { name: "Search query" })
    await user.clear(box)
    await user.type(box, "venue{Enter}")
    expect(await screen.findByLabelText("Loading results")).toBeInTheDocument()
    expect(screen.queryByText(/No results for/)).not.toBeInTheDocument()
    release()
    expect(await screen.findByRole("heading", { level: 2, name: "Matched" })).toBeInTheDocument()
  })

  it("shows the API error with a retry", async () => {
    let calls = 0
    server.use(
      http.get("*/api/search", () => {
        calls += 1
        return calls === 1
          ? HttpResponse.json({ code: "INVALID_INPUT", message: "limit must be an integer from 1 to 200", details: {} }, { status: 400 })
          : HttpResponse.json(searchResult)
      }),
    )
    const { user } = renderApp("/search?q=acme")
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText(/INVALID_INPUT: limit must be/)).toBeInTheDocument()
    await user.click(within(alert).getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("heading", { level: 2, name: "Matched" })).toBeInTheDocument()
  })
})
