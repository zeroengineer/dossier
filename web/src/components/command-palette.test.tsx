import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { emptySearchResult, searchResult } from "@/test/fixtures-search"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

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

async function openPalette(path = "/vault") {
  const app = renderApp(path)
  await screen.findByTestId("nav-user")
  await app.user.keyboard("{Control>}k{/Control}")
  const dialog = await screen.findByRole("dialog")
  return { ...app, dialog, input: within(dialog).getByRole("combobox") }
}

const group = (dialog: HTMLElement, heading: string) => {
  const el = within(dialog).getByText(heading, { selector: "[cmdk-group-heading]" }).closest<HTMLElement>("[cmdk-group]")
  if (!el) throw new Error(`no ${heading} group`)
  return within(el)
}

describe("CommandPalette", () => {
  it("lists Navigate, Create (templates) and Settings without a query, and does not search", async () => {
    const urls = recordSearches()
    const { dialog } = await openPalette()
    expect(group(dialog, "Navigate").getByRole("option", { name: "Documents" })).toBeInTheDocument()
    expect(await within(dialog).findByText("Create", { selector: "[cmdk-group-heading]" })).toBeInTheDocument()
    expect(group(dialog, "Create").getByRole("option", { name: /Offer letter/ })).toBeInTheDocument()
    expect(group(dialog, "Settings").getByRole("option", { name: "Numbering" })).toBeInTheDocument()
    expect(within(dialog).queryByText("Documents", { selector: "[cmdk-group-heading]" })).not.toBeInTheDocument()
    expect(urls).toHaveLength(0)
  })

  it("searches once after typing stops, with limit 8, and groups Documents and Entities", async () => {
    const urls = recordSearches()
    const { dialog, input } = await openPalette()
    // Keystrokes in quick succession (user.type can leave gaps above 200 ms on a loaded test machine).
    for (const value of ["a", "ac", "acm", "acme"]) fireEvent.change(input, { target: { value } })

    const docs = await waitFor(() => group(dialog, "Documents"))
    expect(urls).toHaveLength(1)
    expect(urls[0]?.searchParams.get("q")).toBe("acme")
    expect(urls[0]?.searchParams.get("limit")).toBe("8")

    expect(docs.getByRole("option", { name: /ACM-2026-0007.*Event services invoice/ })).toBeInTheDocument()
    const venue = docs.getByRole("option", { name: /Venue confirmation/ })
    expect(venue.querySelector("mark")).toHaveTextContent("Acme")
    expect(group(dialog, "Entities").getByRole("option", { name: /Alex Example/ })).toBeInTheDocument()
    // Server results are not filtered away by the palette's own matching.
    expect(group(dialog, "Entities").getByRole("option", { name: /Acme Client Co/ })).toBeInTheDocument()
  })

  it("opens the first document on Enter", async () => {
    recordSearches()
    const { user, dialog, input, router } = await openPalette()
    await user.type(input, "acme")
    await waitFor(() => group(dialog, "Documents"))
    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: /Event services invoice/ })).toHaveAttribute("aria-selected", "true"),
    )
    await user.keyboard("{Enter}")
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000001"))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("never opens a previous query's result while the next one is pending", async () => {
    // The second query never answers, so its results stay pending however slow the test machine is.
    server.use(
      http.get("*/api/search", ({ request }) =>
        new URL(request.url).searchParams.get("q") === "acme" ? HttpResponse.json(searchResult) : new Promise<never>(() => {}),
      ),
    )
    const { user, dialog, input, router } = await openPalette()
    await user.type(input, "acme")
    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: /Event services invoice/ })).toHaveAttribute("aria-selected", "true"),
    )
    await user.type(input, "x")
    expect(within(dialog).getByRole("option", { name: /Event services invoice/ })).toHaveAttribute("aria-disabled", "true")
    expect(within(dialog).getByRole("option", { name: "Search for “acmex”" })).toHaveAttribute("aria-selected", "true")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(router.state.location.pathname).toBe("/search"))
    expect(router.state.location.search).toBe("?q=acmex")
  })

  it("keeps the user's arrow-key choice once results are in", async () => {
    recordSearches()
    const { user, dialog, input, router } = await openPalette()
    await user.type(input, "acme")
    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: /Event services invoice/ })).toHaveAttribute("aria-selected", "true"),
    )
    await user.keyboard("{ArrowDown}")
    await new Promise((r) => setTimeout(r, 300))
    expect(within(dialog).getByRole("option", { name: /Venue confirmation/ })).toHaveAttribute("aria-selected", "true")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000004"))
  })

  it("opens an entity", async () => {
    recordSearches()
    const { user, dialog, input, router } = await openPalette()
    await user.type(input, "alex")
    const entities = await waitFor(() => group(dialog, "Entities"))
    await user.click(entities.getByRole("option", { name: /Alex Example/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/entities/7"))
  })

  it("goes to the search page on Enter when nothing matches", async () => {
    recordSearches(emptySearchResult)
    const { user, dialog, input, router } = await openPalette()
    await user.type(input, "zzz quux")
    expect(within(dialog).getByRole("option", { name: "Search for “zzz quux”" })).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).queryByRole("status")).not.toBeInTheDocument())
    await user.keyboard("{Enter}")
    await waitFor(() => expect(router.state.location.pathname).toBe("/search"))
    expect(router.state.location.search).toBe("?q=zzz+quux")
  })

  it("starts generating from a template in the Create group", async () => {
    recordSearches(emptySearchResult)
    const { user, dialog, router } = await openPalette()
    await within(dialog).findByText("Create", { selector: "[cmdk-group-heading]" })
    await user.click(group(dialog, "Create").getByRole("option", { name: /Offer letter/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/generate/offer-letter"))
  })
})
