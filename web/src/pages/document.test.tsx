import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

const viewer = async () => within(await screen.findByTestId("document-viewer"))

describe("Document page", () => {
  it("shows the title, number, status and sensitivity in the header, with the action bar", async () => {
    renderApp("/documents/DOC-000001")
    expect(await screen.findByRole("heading", { level: 1, name: "Event services invoice" })).toBeInTheDocument()
    expect(screen.getByText("DOC-000001 · invoice")).toBeInTheDocument()
    const header = screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement
    expect(within(header).getByText("ACM-2026-0007")).toBeInTheDocument()
    expect(within(header).getByText("Sent")).toBeInTheDocument()
    expect(within(header).getByText("Internal")).toBeInTheDocument()
    const actions = within(screen.getByTestId("document-actions"))
    expect(actions.getByRole("button", { name: "Change status" })).toBeInTheDocument()
    expect(actions.getByRole("link", { name: "Regenerate" })).toBeInTheDocument()
    expect(actions.getByRole("button", { name: "Download" })).toBeInTheDocument()
  })

  it("previews the current version's PDF in an iframe and offers its other renditions as tabs", async () => {
    renderApp("/documents/DOC-000001")
    const v = await viewer()
    expect(v.getByText("Version 2 (current)")).toBeInTheDocument()
    expect(v.getByRole("tab", { name: "PDF" })).toHaveAttribute("aria-selected", "true")
    expect(v.getByRole("tab", { name: "Markdown" })).toBeInTheDocument()
    expect(v.queryByRole("tab", { name: "HTML" })).not.toBeInTheDocument()
    const frame = v.getByTitle("PDF of Event services invoice")
    expect(frame.tagName).toBe("IFRAME")
    expect(frame).toHaveAttribute("src", "/documents/DOC-000001/renditions/pdf?version=2")
    expect(frame).not.toHaveAttribute("sandbox")
    expect(v.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/documents/DOC-000001/renditions/pdf?version=2&download=1")
  })

  it("fetches the Markdown rendition as text into a preformatted block", async () => {
    const { user } = renderApp("/documents/DOC-000001")
    const v = await viewer()
    await user.click(v.getByRole("tab", { name: "Markdown" }))
    const pre = await v.findByLabelText("Markdown of Event services invoice")
    expect(pre.tagName).toBe("PRE")
    await waitFor(() => expect(pre).toHaveTextContent("Version 2 of ACM-2026-0007."))
  })

  it("drives the viewer from the versions table and shows HTML in a sandboxed iframe", async () => {
    const { user, router } = renderApp("/documents/DOC-000001")
    await viewer()
    await user.click(screen.getByRole("button", { name: "Show version 1" }))
    await waitFor(() => expect(router.state.location.search).toBe("?version=1"))
    const v = await viewer()
    expect(v.getByText("Version 1")).toBeInTheDocument()
    expect(v.getByTitle("PDF of Event services invoice")).toHaveAttribute("src", "/documents/DOC-000001/renditions/pdf?version=1")
    await user.click(v.getByRole("tab", { name: "HTML" }))
    const html = v.getByTitle("HTML of Event services invoice")
    expect(html).toHaveAttribute("sandbox", "")
    expect(html).toHaveAttribute("src", "/documents/DOC-000001/renditions/html?version=1")
    expect(screen.getByRole("button", { name: "Show version 1" })).toHaveAttribute("aria-pressed", "true")

    await user.click(screen.getByRole("button", { name: "Show version 2" }))
    await waitFor(() => expect(router.state.location.search).toBe(""))
  })

  it("opens the version named in ?version= and fetches its Markdown", async () => {
    const { user } = renderApp("/documents/DOC-000001?version=1")
    const v = await viewer()
    expect(v.getByText("Version 1")).toBeInTheDocument()
    await user.click(v.getByRole("tab", { name: "Markdown" }))
    await waitFor(() => expect(v.getByLabelText("Markdown of Event services invoice")).toHaveTextContent("Version 1 of ACM-2026-0007."))
  })

  it("lists metadata, linked entities and relations in both directions with links", async () => {
    renderApp("/documents/DOC-000001")
    const details = await screen.findByLabelText("Document details")
    expect(within(details).getByText("acme-invoice v3")).toBeInTheDocument()
    expect(within(details).getByRole("link", { name: "Events" })).toHaveAttribute("href", "/entities/5")

    const entities = screen.getByRole("list", { name: "Linked entities" })
    expect(within(entities).getByRole("link", { name: "Alex Example" })).toHaveAttribute("href", "/entities/7")
    expect(within(entities).getByText("signatory")).toBeInTheDocument()

    const relations = screen.getByRole("list", { name: "Relations" })
    expect(within(relations).getByRole("link", { name: "Event services proposal" })).toHaveAttribute("href", "/documents/DOC-000004")
    expect(within(relations).getByText("based on")).toBeInTheDocument()
    expect(within(relations).getByRole("link", { name: "Payment receipt" })).toHaveAttribute("href", "/documents/DOC-000005")
    expect(within(relations).getByText("pays (incoming)")).toBeInTheDocument()
    expect(within(relations).getByText("Template acme-invoice")).toBeInTheDocument()
  })

  it("shows an empty state when the document has no renditions", async () => {
    renderApp("/documents/DOC-000003")
    const v = await viewer()
    expect(v.getByText("No renditions")).toBeInTheDocument()
    expect(v.queryByRole("tab")).not.toBeInTheDocument()
    expect(screen.getByText("No versions yet.")).toBeInTheDocument()
    expect(screen.getByText("No related documents.")).toBeInTheDocument()
  })

  it("offers a download for an uploaded file that cannot be shown inline", async () => {
    renderApp("/documents/DOC-000006")
    const v = await viewer()
    expect(v.getByRole("tab", { name: "Original" })).toBeInTheDocument()
    expect(v.getByText("No inline preview")).toBeInTheDocument()
    expect(v.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/documents/DOC-000006/renditions/original?version=1&download=1")
  })

  it("explains a 403 without offering a retry", async () => {
    renderApp("/documents/DOC-000002")
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("You do not have access to this document")).toBeInTheDocument()
    expect(within(alert).getByText(/FORBIDDEN/)).toBeInTheDocument()
    expect(within(alert).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "All documents" })).toHaveAttribute("href", "/documents")
  })

  it("shows not found for an unknown document", async () => {
    renderApp("/documents/DOC-999999")
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("Document not found")).toBeInTheDocument()
    expect(within(alert).getByText(/DOCUMENT_NOT_FOUND/)).toBeInTheDocument()
  })

  it("offers a retry when the server fails", async () => {
    let calls = 0
    server.use(
      http.get("*/api/documents/:id", () => {
        calls += 1
        return HttpResponse.json({ code: "INTERNAL", message: "Boom", details: {} }, { status: 500 })
      }),
    )
    const { user } = renderApp("/documents/DOC-000001")
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("Could not load the document")).toBeInTheDocument()
    await user.click(within(alert).getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(calls).toBe(2))
  })
})
