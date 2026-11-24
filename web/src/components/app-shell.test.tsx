import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { renderApp } from "@/test/render"

/** The sidebar's own element (the breadcrumbs also link to pages). */
async function sidebar() {
  await screen.findByTestId("nav-user")
  const el = document.querySelector<HTMLElement>("[data-slot=sidebar-inner]") ?? document.querySelector<HTMLElement>("[data-sidebar=sidebar]")
  if (!el) throw new Error("sidebar not rendered")
  return within(el)
}
import { server } from "@/test/server"

describe("AppShell", () => {
  it("renders the Workspace, Create and System navigation groups", async () => {
    renderApp("/documents")
    const nav = await sidebar()
    expect(nav.getByText("Workspace", { selector: "[data-sidebar=group-label]" })).toBeInTheDocument()
    expect(nav.getByText("Create", { selector: "[data-sidebar=group-label]" })).toBeInTheDocument()
    expect(nav.getByText("System", { selector: "[data-sidebar=group-label]" })).toBeInTheDocument()
    for (const name of ["Dashboard", "Vault", "Documents", "Entities", "Generate", "Templates", "Upload", "Brands", "Numbering", "Workspace", "Users"]) {
      expect(nav.getByRole("link", { name })).toBeInTheDocument()
    }
  })

  it("marks the current page's nav item active", async () => {
    renderApp("/documents/DOC-000001")
    const nav = await sidebar()
    const documents = nav.getByRole("link", { name: "Documents" })
    expect(documents).toHaveAttribute("data-active", "true")
    expect(documents).toHaveAttribute("aria-current", "page")
    expect(nav.getByRole("link", { name: "Vault" })).toHaveAttribute("data-active", "false")
    expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("data-active", "false")
  })

  it("tells the Workspace and Users settings items apart by hash", async () => {
    renderApp("/settings/workspace#users")
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
    renderApp("/vault")
    const user = await screen.findByTestId("nav-user")
    expect(within(user).getByText("demo")).toBeInTheDocument()
    expect(within(user).getByText("Confidential clearance")).toBeInTheDocument()
  })

  it("lists the workspace's brands in the switcher and remembers the choice", async () => {
    const { user } = renderApp("/vault")
    const trigger = await screen.findByRole("button", { name: /Acme Events/ })
    await user.click(trigger)
    await user.click(await screen.findByRole("menuitem", { name: /Acme Studio/ }))
    await waitFor(() => expect(window.localStorage.getItem("dossier.activeBrand")).toBe("acme-studio"))
    expect(await screen.findByRole("button", { name: /Acme Studio/ })).toBeInTheDocument()
  })

  it("opens the command palette with Ctrl+K and navigates to the chosen page", async () => {
    const { user, router } = renderApp("/vault")
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
    const { user } = renderApp("/vault")
    await screen.findByTestId("nav-user")
    await user.keyboard("{Meta>}k{/Meta}")
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("renders placeholder pages with their title and an empty state", async () => {
    renderApp("/templates")
    expect(await screen.findByRole("heading", { level: 1, name: "Templates" })).toBeInTheDocument()
    expect(screen.getByText("This page is being built")).toBeInTheDocument()
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
})
