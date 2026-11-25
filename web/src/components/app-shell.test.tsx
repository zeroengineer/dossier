import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, describe, expect, it } from "vitest"
import { AppShell } from "@/components/app-shell"
import { expectNoAxeViolations } from "@/test/axe"
import { OtherRoute, renderApp, renderRoute } from "@/test/render"

/** The sidebar's own element (the breadcrumbs also link to pages). */
async function sidebar() {
  await screen.findByTestId("nav-user")
  const el = document.querySelector<HTMLElement>("[data-slot=sidebar-inner]") ?? document.querySelector<HTMLElement>("[data-sidebar=sidebar]")
  if (!el) throw new Error("sidebar not rendered")
  return within(el)
}
import { server } from "@/test/server"

/** The shell around a placeholder page: no lazy page chunk to load, so only the shell's own behaviour is under test. */
function renderShell(path: string) {
  return renderRoute(<AppShell />, path, { route: "/", children: [{ path: "*", element: <OtherRoute /> }], toaster: false })
}

describe("AppShell", () => {
  it("renders the Workspace, Create and System navigation groups", async () => {
    renderShell("/documents")
    const nav = await sidebar()
    expect(nav.getByText("Workspace", { selector: "[data-sidebar=group-label]" })).toBeInTheDocument()
    expect(nav.getByText("Create", { selector: "[data-sidebar=group-label]" })).toBeInTheDocument()
    expect(nav.getByText("System", { selector: "[data-sidebar=group-label]" })).toBeInTheDocument()
    for (const name of ["Dashboard", "Vault", "Documents", "Entities", "Generate", "Templates", "Upload", "Brands", "Numbering", "Workspace", "Users"]) {
      expect(nav.getByRole("link", { name })).toBeInTheDocument()
    }
  })

  it("marks the current page's nav item active", async () => {
    renderShell("/documents/DOC-000001")
    const nav = await sidebar()
    const documents = nav.getByRole("link", { name: "Documents" })
    expect(documents).toHaveAttribute("data-active", "true")
    expect(documents).toHaveAttribute("aria-current", "page")
    expect(nav.getByRole("link", { name: "Vault" })).toHaveAttribute("data-active", "false")
    expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("data-active", "false")
  })

  it("tells the Workspace and Users settings items apart by hash", async () => {
    renderShell("/settings/workspace#users")
    const nav = await sidebar()
    expect(nav.getByRole("link", { name: "Users" })).toHaveAttribute("data-active", "true")
    expect(nav.getByRole("link", { name: "Workspace" })).toHaveAttribute("data-active", "false")
  })

  it("shows breadcrumbs from the route handles", async () => {
    renderApp("/documents/DOC-000001")
    const nav = await screen.findByRole("navigation", { name: /breadcrumb/i })
    expect(within(nav).getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/documents")
    expect(within(nav).getByText("DOC-000001")).toHaveAttribute("aria-current", "page")
  })

  it("shows the user from /api/me in the footer with their clearance", async () => {
    renderShell("/vault")
    const user = await screen.findByTestId("nav-user")
    expect(within(user).getByText("demo")).toBeInTheDocument()
    expect(within(user).getByText("Confidential", { selector: "[data-slot=badge]" })).toBeInTheDocument()
  })

  it("puts the sidebar groups in a Main navigation landmark", async () => {
    renderShell("/vault")
    await sidebar()
    const main = screen.getByRole("navigation", { name: "Main" })
    for (const name of ["Vault", "Generate", "Brands"]) expect(within(main).getByRole("link", { name })).toBeInTheDocument()
  })

  it("keeps the settings pages reachable from the icon rail through a flyout", async () => {
    const { user, router } = renderShell("/vault")
    await sidebar()
    const trigger = document.querySelector<HTMLElement>("[data-sidebar=trigger]")
    if (!trigger) throw new Error("no sidebar trigger")
    await user.click(trigger)
    await waitFor(() => expect(document.querySelector("[data-state=collapsed]")).not.toBeNull())
    expect(screen.queryByRole("link", { name: "Numbering" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Settings" }))
    await user.click(await screen.findByRole("menuitem", { name: "Numbering" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/numbering"))
  })

  it("names the header's palette button by its visible text", async () => {
    renderShell("/vault")
    await sidebar()
    expect(screen.getByRole("button", { name: /^Search or jump to…/ })).toBeInTheDocument()
  })

  it("lists the workspace's brands in the switcher and remembers the choice", async () => {
    const { user } = renderShell("/vault")
    const trigger = await screen.findByRole("button", { name: /Acme Events/ })
    await user.click(trigger)
    await user.click(await screen.findByRole("menuitem", { name: /Acme Studio/ }))
    await waitFor(() => expect(window.localStorage.getItem("dossier.activeBrand")).toBe("acme-studio"))
    expect(await screen.findByRole("button", { name: /Acme Studio/ })).toBeInTheDocument()
  })

  it("opens the command palette with Ctrl+K and navigates to the chosen page", async () => {
    const { user, router } = renderShell("/vault")
    await screen.findByTestId("nav-user")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.keyboard("{Control>}k{/Control}")
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("option", { name: "Templates" })).toBeInTheDocument()

    await user.type(within(dialog).getByRole("combobox"), "templ")
    await user.click(within(dialog).getByRole("option", { name: "Templates" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/templates"))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("opens the command palette with ⌘K too", async () => {
    const { user } = renderShell("/vault")
    await screen.findByTestId("nav-user")
    await user.keyboard("{Meta>}k{/Meta}")
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("renders a not-found page for unknown paths inside the shell", async () => {
    renderApp("/nowhere")
    expect(await screen.findByText("Page not found")).toBeInTheDocument()
    expect((await sidebar()).getByRole("link", { name: "Documents" })).toBeInTheDocument()
  })

  it("keeps the shell when /api/me fails", async () => {
    server.use(http.get("*/api/me", () => HttpResponse.json({ code: "INTERNAL", message: "Internal server error", details: {} }, { status: 500 })))
    renderApp("/templates")
    expect(await screen.findByRole("heading", { level: 1, name: "Templates" })).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: "Vault" }).length).toBeGreaterThan(0)
    expect(screen.queryByTestId("nav-user")).not.toBeInTheDocument()
  })

  it("starts with a skip link that moves focus to the main content", async () => {
    const { user } = renderShell("/vault")
    await sidebar()
    await user.tab()
    const skip = screen.getByRole("link", { name: "Skip to main content" })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute("href", "#main-content")
    const target = document.getElementById("main-content")
    expect(target).not.toBeNull()
    expect(screen.getByRole("main")).toContainElement(target)
    expect(target).toContainElement(screen.getByTestId("other-route"))
    expect(target).toHaveAttribute("tabindex", "-1")
  })

  it("has no axe violations", async () => {
    renderShell("/vault")
    await sidebar()
    await expectNoAxeViolations()
  })

  describe("below 768 px", () => {
    const desktopWidth = window.innerWidth
    afterEach(() => {
      window.innerWidth = desktopWidth
    })

    it("shows the sidebar as a Sheet that the header trigger opens and a link closes", async () => {
      window.innerWidth = 500
      const { user, router } = renderShell("/vault")
      // No inline sidebar on a phone: the navigation lives in the Sheet until it is opened.
      await screen.findByRole("button", { name: "Toggle Sidebar" })
      expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }))
      const sheet = await screen.findByRole("dialog", { name: "Sidebar" })
      expect(sheet).toHaveAttribute("data-mobile", "true")
      const nav = within(sheet).getByRole("navigation", { name: "Main" })
      await user.click(within(nav).getByRole("link", { name: "Documents" }))
      await waitFor(() => expect(router.state.location.pathname).toBe("/documents"))
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sidebar" })).not.toBeInTheDocument())
    })
  })
})
