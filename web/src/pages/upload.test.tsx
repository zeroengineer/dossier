import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"
import { keys } from "@/lib/keys"
import { meta } from "@/test/fixtures"
import { acmeEvents, alexExample } from "@/test/fixtures-documents"
import { newDocumentResult, uploadSeries } from "@/test/fixtures-upload"
import { renderApp } from "@/test/render"
import { server } from "@/test/server"

interface Captured {
  fields: Record<string, string>
  file: File | null
  client: string | null
}

/** Series and party lookups (owned by other areas, so not default handlers), and a recorder for upload bodies. */
function setup({ answer }: { answer?: () => Response } = {}) {
  const uploads: Captured[] = []
  server.use(
    http.get("*/api/series", () => HttpResponse.json({ series: uploadSeries })),
    http.get("*/api/entities", ({ request }) => {
      const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase()
      return HttpResponse.json({ entities: [acmeEvents, alexExample].filter((e) => e.name.toLowerCase().includes(q)) })
    }),
    http.get("*/api/entities/:id", ({ params }) => {
      const e = [acmeEvents, alexExample].find((x) => String(x.id) === params["id"])
      return e ? HttpResponse.json(e) : HttpResponse.json({ code: "ENTITY_NOT_FOUND", message: "No such entity", details: {} }, { status: 404 })
    }),
    http.post("*/api/upload", async ({ request }) => {
      const body = await request.clone().formData()
      const fields: Record<string, string> = {}
      let file: File | null = null
      for (const [k, v] of body.entries()) {
        if (typeof v === "string") fields[k] = v
        else file = v
      }
      uploads.push({ fields, file, client: request.headers.get("X-Dossier-Client") })
      return answer ? answer() : undefined
    }),
  )
  return uploads
}

const pdf = () => new File(["%PDF-1.7 example"], "stage-invoice.pdf", { type: "application/pdf" })
const findForm = (name: string) => screen.findByRole("form", { name }, { timeout: 10_000 })

type User = ReturnType<typeof renderApp>["user"]

async function chooseOption(user: User, label: string | RegExp, option: string | RegExp) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole("option", { name: option }))
}

async function pickType(user: User, type: string) {
  await user.click(screen.getByRole("combobox", { name: "Type" }))
  await user.click(await screen.findByRole("option", { name: type }))
}

describe("Upload page", { timeout: 20_000 }, () => {
  it("uploads a new document as multipart with the metadata, then opens it and refreshes lists", async () => {
    const uploads = setup()
    const { user, router, queryClient } = renderApp("/upload")
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    await findForm("Upload a new document")

    await user.upload(screen.getByLabelText("File"), pdf())
    expect(screen.getByTestId("upload-file-name")).toHaveTextContent("stage-invoice.pdf")
    await pickType(user, "invoice")
    await user.type(screen.getByLabelText("Title"), "Stage invoice")

    await user.click(screen.getByRole("combobox", { name: "Party" }))
    await user.click(await screen.findByRole("option", { name: /Acme Events/ }))
    expect(screen.getByRole("combobox", { name: "Party" })).toHaveTextContent("Acme Events")
    await chooseOption(user, "Party type", "Client")

    await user.type(screen.getByLabelText("Number"), "ACM-2026-0001")
    await chooseOption(user, "Number series", /invoice-main/)
    await user.type(screen.getByLabelText("Date"), "2026-04-01")
    await user.type(screen.getByLabelText("Amount"), "1,234.50")
    await user.type(screen.getByLabelText("Currency"), "inr")
    await chooseOption(user, "Status", "Sent")

    await user.click(screen.getByRole("button", { name: "Upload" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000006"))
    expect(uploads).toHaveLength(1)
    const [sent] = uploads
    expect(sent!.client).toBe("web")
    // jsdom's File loses its name on the way through Node's fetch (it arrives as "blob"); the bytes are what we check.
    // The file name itself is covered by upload-data.test.ts (toUploadFormData).
    expect(await sent!.file?.text()).toBe("%PDF-1.7 example")
    expect(sent!.fields).toEqual({
      type: "invoice",
      title: "Stage invoice",
      partyId: "7",
      partyType: "Client",
      docNumber: "ACM-2026-0001",
      numberSeries: "invoice-main",
      docDate: "2026-04-01",
      amount: "1,234.50",
      currency: "INR",
      status: "Sent",
      sensitivity: "Internal",
    })
    const prefixes = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
    expect(prefixes).toEqual(expect.arrayContaining([JSON.stringify(keys.documents.all), JSON.stringify(["dashboard"]), JSON.stringify(["tree"])]))
    expect(await screen.findByText("Uploaded Venue agreement")).toBeInTheDocument()
  })

  it("requires a file and a type before sending anything", async () => {
    const uploads = setup()
    const { user } = renderApp("/upload")
    await findForm("Upload a new document")
    await user.click(screen.getByRole("button", { name: "Upload" }))
    expect(await screen.findByText("Choose a document type")).toBeInTheDocument()

    await pickType(user, "letter")
    await user.click(screen.getByRole("button", { name: "Upload" }))
    expect(await screen.findByText("Choose a file to upload.")).toBeInTheDocument()
    expect(uploads).toHaveLength(0)
  })

  it("lets the user type a document type that is not listed", async () => {
    const uploads = setup()
    const { user, router } = renderApp("/upload")
    await findForm("Upload a new document")
    await user.upload(screen.getByLabelText("File"), pdf())
    await user.click(screen.getByRole("combobox", { name: "Type" }))
    await user.type(await screen.findByPlaceholderText("Search types…"), "Purchase order")
    await user.click(await screen.findByRole("option", { name: "Use “Purchase order”" }))
    await user.click(screen.getByRole("button", { name: "Upload" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000006"))
    expect(uploads[0]!.fields["type"]).toBe("Purchase order")
  })

  it("offers sensitivity levels only up to the user's clearance", async () => {
    setup()
    const { user } = renderApp("/upload")
    await findForm("Upload a new document")
    expect(screen.getByLabelText("Sensitivity")).toHaveTextContent("Internal")
    await user.click(screen.getByLabelText("Sensitivity"))
    const listbox = await screen.findByRole("listbox")
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual(["Public", "Internal", "Confidential"])
  })

  it("reports a reused file and number-conflict warnings", async () => {
    setup({
      answer: () => HttpResponse.json(
        { ...newDocumentResult, document: { ...newDocumentResult.document, docNumber: "ACM-2026-0007", numberSeries: "invoice-main", numberConflict: true }, deduped: true, warnings: ["NUMBER_CONFLICT"] },
        { status: 201 },
      ),
    })
    const { user, router } = renderApp("/upload")
    await findForm("Upload a new document")
    await user.upload(screen.getByLabelText("File"), pdf())
    await pickType(user, "invoice")
    await user.click(screen.getByRole("button", { name: "Upload" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000006"))
    expect(await screen.findByText("This file was already stored")).toBeInTheDocument()
    expect(await screen.findByText("NUMBER_CONFLICT")).toBeInTheDocument()
    expect(screen.getByText("Number ACM-2026-0007 is already used in series invoice-main. The document is flagged with a number conflict.")).toBeInTheDocument()
  })

  it("explains the size limit when the server answers 413", async () => {
    setup({ answer: () => HttpResponse.json({ code: "PAYLOAD_TOO_LARGE", message: "request file too large", details: {} }, { status: 413 }) })
    const { user, router } = renderApp("/upload")
    await findForm("Upload a new document")
    await user.upload(screen.getByLabelText("File"), pdf())
    await pickType(user, "invoice")
    await user.click(screen.getByRole("button", { name: "Upload" }))
    const alert = await screen.findByText("The file is larger than the 50 MB upload limit. Choose a smaller file.")
    expect(alert).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/upload")
  })

  it("refuses a file over the limit before uploading it", async () => {
    const uploads = setup()
    server.use(http.get("*/api/meta", () => HttpResponse.json({ ...meta, limits: { ...meta.limits, uploadMaxBytes: 4 } })))
    const { user } = renderApp("/upload")
    await findForm("Upload a new document")
    await user.upload(screen.getByLabelText("File"), pdf())
    await pickType(user, "invoice")
    await user.click(screen.getByRole("button", { name: "Upload" }))
    expect(await screen.findByText("The file is larger than the 1 KB upload limit. Choose a smaller file.")).toBeInTheDocument()
    expect(uploads).toHaveLength(0)
  })

  it("shows a server validation error and marks the field it names", async () => {
    setup({
      answer: () => HttpResponse.json(
        { code: "INVALID_INPUT", message: "currency must be a 3-letter ISO code like INR", details: { currency: "IN" } },
        { status: 400 },
      ),
    })
    const { user } = renderApp("/upload")
    await findForm("Upload a new document")
    await user.upload(screen.getByLabelText("File"), pdf())
    await pickType(user, "invoice")
    await user.type(screen.getByLabelText("Currency"), "in")
    await user.click(screen.getByRole("button", { name: "Upload" }))
    expect(await screen.findByText("INVALID_INPUT: currency must be a 3-letter ISO code like INR")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("Currency")).toHaveAttribute("aria-invalid", "true"))
  })

  it("uploads a new version with a note and make-current flag only", async () => {
    const uploads = setup()
    const { user, router } = renderApp("/upload?documentId=DOC-000001")
    await findForm("Upload a new version")
    expect(screen.getByRole("heading", { name: "Upload new version" })).toBeInTheDocument()
    const target = await screen.findByTestId("upload-target")
    expect(within(target).getByText("Event services invoice")).toBeInTheDocument()
    expect(within(target).getByText(/current version 2/)).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Type" })).not.toBeInTheDocument()

    await user.upload(screen.getByLabelText("File"), pdf())
    await user.type(screen.getByLabelText("Version note"), "Countersigned copy")
    await user.click(screen.getByLabelText("Make this the current version"))
    await user.click(screen.getByRole("button", { name: "Upload version" }))

    await waitFor(() => expect(router.state.location.pathname).toBe("/documents/DOC-000001"))
    expect(uploads[0]!.fields).toEqual({ documentId: "DOC-000001", note: "Countersigned copy", makeCurrent: "false" })
    expect(await screen.findByText("Version 3 of ACM-2026-0007 uploaded")).toBeInTheDocument()
  })

  it("shows when the target document of a new version cannot be loaded", async () => {
    setup()
    renderApp("/upload?documentId=DOC-404404")
    await findForm("Upload a new version")
    expect(await screen.findByText(/DOCUMENT_NOT_FOUND/)).toBeInTheDocument()
  })
})
