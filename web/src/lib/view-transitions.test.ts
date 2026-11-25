import { describe, expect, it, vi } from "vitest"
import type { createBrowserRouter } from "react-router"
import { targetPathname, wantsViewTransition, withViewTransitions } from "./view-transitions"

const HREF = "http://127.0.0.1/documents?status=Draft"

describe("wantsViewTransition", () => {
  it("animates a change of page", () => {
    expect(wantsViewTransition("/entities", HREF, false)).toBe(true)
    expect(wantsViewTransition({ pathname: "/documents/DOC-000001" }, HREF, false)).toBe(true)
    expect(wantsViewTransition("DOC-000001", HREF, false)).toBe(true)
  })

  it("keeps query-string changes on the same page instant (tabs, filters, pagination)", () => {
    expect(wantsViewTransition("?status=Sent", HREF, false)).toBe(false)
    expect(wantsViewTransition({ search: "?page=2" }, HREF, false)).toBe(false)
    expect(wantsViewTransition("/documents?type=Invoice", HREF, false)).toBe(false)
  })

  it("never animates under reduced motion", () => {
    expect(wantsViewTransition("/entities", HREF, true)).toBe(false)
  })

  it("leaves history steps alone", () => {
    expect(targetPathname(-1 as never, HREF)).toBeNull()
  })
})

describe("withViewTransitions", () => {
  type Router = ReturnType<typeof createBrowserRouter>
  const fakeRouter = () => {
    const navigate = vi.fn(async () => {})
    return { router: { navigate } as unknown as Router, navigate }
  }

  it("passes viewTransition for page changes and keeps an explicit choice", async () => {
    window.history.replaceState(null, "", "/documents")
    const { router, navigate } = fakeRouter()
    withViewTransitions(router)
    await router.navigate("/vault")
    expect(navigate).toHaveBeenLastCalledWith("/vault", { viewTransition: true })
    await router.navigate("?page=2", { replace: true })
    expect(navigate).toHaveBeenLastCalledWith("?page=2", { replace: true, viewTransition: false })
    await router.navigate("/vault", { viewTransition: false })
    expect(navigate).toHaveBeenLastCalledWith("/vault", { viewTransition: false })
    await router.navigate(-1)
    expect(navigate).toHaveBeenLastCalledWith(-1)
  })
})
