import { screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import type { BrandDetail, BrandFile } from "@/api/types"
import { CONFLICT_TEXT } from "@/features/settings/save-failure"
import { acmeFile, brandDetails } from "@/test/fixtures-brands"
import BrandSettingsPage from "@/pages/settings-brand"
import { renderRoute } from "@/test/render"
import { server } from "@/test/server"

/** Capture PUT /api/brands/:id bodies; the reply (and later GETs) echo the body as the new file. */
function capturePuts() {
  const bodies: BrandFile[] = []
  const saved: Record<string, BrandDetail> = {}
  server.use(
    http.put("*/api/brands/:id", async ({ params, request }) => {
      const id = String(params["id"])
      const body = (await request.json()) as BrandFile
      bodies.push(body)
      saved[id] = { ...brandDetails[id]!, file: body, configHash: "dddddddddddd4444" }
      return HttpResponse.json(saved[id])
    }),
    http.get("*/api/brands/:id", ({ params }) => {
      const id = String(params["id"])
      return HttpResponse.json(saved[id] ?? brandDetails[id])
    }),
  )
  return bodies
}

const invalid = (errors: Array<{ file?: string; path: string; message: string }>) =>
  HttpResponse.json(
    { code: "WORKSPACE_INVALID", message: "brands/acme/brand.json: invalid", details: { file: "brands/acme/brand.json", errors } },
    { status: 400 },
  )

async function openEditor(path = "/settings/brands/acme") {
  const app = renderRoute(<BrandSettingsPage />, path, { route: "/settings/brands/:id" })
  await screen.findByRole("form", { name: /^Brand / })
  return app
}

const saveButton = () => screen.getByRole("button", { name: "Save brand" })

describe("Brand editor", () => {
  it("loads the brand file into the form, with the preview and download link", async () => {
    await openEditor()
    expect(screen.getByRole("heading", { name: "acme" })).toBeInTheDocument()
    expect(screen.getByLabelText("Legal name *")).toHaveValue("Acme Events Private Limited")
    expect(screen.getByLabelText("Project contact")).toHaveValue("ops")
    expect(screen.getByTitle("Letterhead preview")).toHaveAttribute("src", "/api/brands/acme/preview.pdf?ts=aaaaaaaaaaaa")
    expect(screen.getByRole("link", { name: "Download brand.json" })).toHaveAttribute("href", "/api/brands/acme/file")
    expect(screen.getAllByRole("tab")).toHaveLength(15)
    expect(screen.getByText("All changes saved.")).toBeInTheDocument()
  })

  it("saves the whole file with PUT, keeping keys the form does not edit", async () => {
    const bodies = capturePuts()
    const { user } = await openEditor()
    const name = screen.getByLabelText("Short name *")
    await user.clear(name)
    await user.type(name, "Acme")
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ ...acmeFile, shortName: "Acme" })
    expect(await screen.findByText("All changes saved.")).toBeInTheDocument()
    expect(screen.getByTitle("Letterhead preview")).toHaveAttribute("src", "/api/brands/acme/preview.pdf?ts=dddddddddddd")
  })

  it("sends the loaded file hash and, on 409 CONFLICT, shows the conflict alert and reloads on request", async () => {
    const matches: Array<string | null> = []
    server.use(
      http.put("*/api/brands/:id", ({ request }) => {
        matches.push(request.headers.get("If-Match"))
        return HttpResponse.json({ code: "CONFLICT", message: "brands/acme/brand.json changed elsewhere", details: { currentHash: "9f".repeat(32) } }, { status: 409 })
      }),
    )
    const { user } = await openEditor()
    const name = screen.getByLabelText("Short name *")
    await user.clear(name)
    await user.type(name, "Mine")
    await user.click(saveButton())
    const alert = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("form [data-slot=alert]")
      expect(el).not.toBeNull()
      return el!
    })
    expect(within(alert).getByText(CONFLICT_TEXT)).toBeInTheDocument()
    expect(matches).toEqual([`"${brandDetails["acme"]!.fileHash}"`])
    expect(name).toHaveValue("Mine")

    server.use(
      http.get("*/api/brands/:id", () =>
        HttpResponse.json({ ...brandDetails["acme"], file: { ...acmeFile, shortName: "Theirs" }, fileHash: "9f".repeat(32) })),
    )
    await user.click(within(alert).getByRole("button", { name: "Reload" }))
    await waitFor(() => expect(screen.getByLabelText("Short name *")).toHaveValue("Theirs"))
    expect(document.querySelector("form [data-slot=alert]")).toBeNull()
    expect(screen.getByText("All changes saved.")).toBeInTheDocument()
  })

  it("puts WORKSPACE_INVALID errors on their fields and opens the tab of the first one", async () => {
    server.use(
      http.put("*/api/brands/:id", () =>
        invalid([
          { file: "brands/acme/brand.json", path: "contacts.hr.email", message: "must be an email" },
          { file: "brands/acme-studio/brand.json", path: "legalName", message: "must not be empty" },
        ]),
      ),
    )
    const { user } = await openEditor()
    await user.click(saveButton())
    const field = await screen.findByLabelText("Email (contact 2)")
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("must be an email")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Contacts.*has errors/ })).toHaveAttribute("aria-selected", "true")
    // An error about another file is listed, not put on this brand's field.
    expect(screen.getByText("brands/acme-studio/brand.json legalName: must not be empty")).toBeInTheDocument()
  })

  it("stops on problems it can see before saving (bad colour) without calling the API", async () => {
    const bodies = capturePuts()
    const { user } = await openEditor("/settings/brands/acme?tab=palette")
    const ink = screen.getByLabelText("ink colour")
    await user.clear(ink)
    await user.type(ink, "blue")
    expect(screen.getByRole("checkbox", { name: "Default ink" })).not.toBeChecked()
    await user.click(saveButton())
    expect(await screen.findByText("must be a hex colour like #1a1a1a")).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it("edits a list and a map with add and remove", async () => {
    const bodies = capturePuts()
    const { user } = await openEditor("/settings/brands/acme?tab=registrations")
    await user.click(screen.getByRole("button", { name: "Remove registration 1" }))
    await user.click(screen.getByRole("button", { name: "Add registration" }))
    await user.type(screen.getByLabelText("Label (registration 2)"), "GSTIN")
    await user.type(screen.getByLabelText("Value (registration 2)"), "00AAAAA0000A0Z0")
    await user.click(screen.getByRole("tab", { name: "Strings" }))
    await user.click(screen.getByRole("button", { name: "Remove string 2" }))
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]!["registrations"]).toEqual([{ label: "PAN", value: "AAAAA0000A" }, { label: "GSTIN", value: "00AAAAA0000A0Z0" }])
    expect(bodies[0]!["strings"]).toEqual({ confidential: "Confidential" })
  })

  it("asks before leaving with unsaved changes", async () => {
    const { user, router } = await openEditor()
    await user.type(screen.getByLabelText("Short name *"), " X")
    const nav = screen.getByRole("navigation", { name: "Settings" })
    await user.click(within(nav).getByRole("link", { name: "Numbering" }))
    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving?" })
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(router.state.location.pathname).toBe("/settings/brands/acme")
    await user.click(within(nav).getByRole("link", { name: "Numbering" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/numbering"))
  })

  it("discards unsaved changes", async () => {
    const { user } = await openEditor()
    const name = screen.getByLabelText("Short name *")
    await user.type(name, " X")
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(screen.getByLabelText("Short name *")).toHaveValue("Acme Events")
  })
})

describe("Brand editor for an inheriting brand", () => {
  it("shows inherited values as placeholders and saves only the overrides", async () => {
    const bodies = capturePuts()
    const { user } = await openEditor("/settings/brands/acme-studio")
    expect(screen.getByText(/^Inherits from/, { selector: "[data-slot=badge]" })).toBeInTheDocument()
    const short = screen.getByLabelText("Short name")
    expect(short).toHaveValue("Acme Studio")
    await user.clear(short)
    expect(short).toHaveAttribute("placeholder", "Acme Events")

    await user.click(screen.getByRole("tab", { name: "Registrations" }))
    expect(screen.getByLabelText("Label (registration 1)")).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Add registration" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("switch", { name: "Override the inherited list" }))
    await user.click(screen.getByRole("button", { name: "Remove registration 2" }))

    await user.click(screen.getByRole("tab", { name: "Strings" }))
    expect(within(screen.getByRole("table", { name: "Inherited strings" })).getByText("confidential")).toBeInTheDocument()

    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      id: "acme-studio",
      inheritsFrom: "acme",
      legalName: "Acme Studio LLP",
      registrations: [{ label: "CIN", value: "U00000XX2000PTC000000" }],
      contacts: { default: { email: "studio@example.com" } },
      strings: { thankYou: "THANKS FROM THE STUDIO" },
    })
  })
})

describe("Brand assets", () => {
  it("lists every slot with where its file comes from", async () => {
    await openEditor("/settings/brands/acme?tab=assets")
    const logo = await screen.findByRole("group", { name: "Logo" })
    expect(within(logo).getByText("Own file")).toBeInTheDocument()
    expect(within(logo).getByRole("img", { name: "Logo of acme" })).toHaveAttribute("src", "/assets/brands/acme/logo?v=0123456789ab")
    expect(within(screen.getByRole("group", { name: "Seal" })).getByText("Placeholder")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Watermark" })).getByText("Not set")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Large signature: ops" })).getByText("Uses the signature")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Font: regular" })).getByText("Own file")).toBeInTheDocument()
  })

  it("uploads a file as multipart with the web client header and shows the new path", async () => {
    let seen: { key: string; client: string | null; file: string | null } | null = null
    server.use(
      http.post("*/api/brands/:id/assets/:key", async ({ params, request }) => {
        const data = await request.formData()
        const file = data.get("file")
        seen = { key: String(params["key"]), client: request.headers.get("X-Dossier-Client"), file: typeof file === "object" && file !== null && "name" in file ? String(file.name) : null }
        const file2 = { ...acmeFile, assets: { logo: "assets/logo-abcdef123456.png", seal: "assets/seal.png" } }
        return HttpResponse.json({ key: "assets.logo", path: "assets/logo-abcdef123456.png", sha256: "abcdef", bytes: 4, brand: { ...brandDetails["acme"], file: file2 } })
      }),
    )
    const { user } = await openEditor("/settings/brands/acme?tab=assets")
    await screen.findByRole("group", { name: "Logo" })
    await user.upload(screen.getByLabelText("Upload Logo"), new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "new-logo.png", { type: "image/png" }))
    await waitFor(() => expect(screen.getByLabelText("Logo path")).toHaveValue("assets/logo-abcdef123456.png"))
    // jsdom's FormData reaches MSW without the file name; the part itself is what matters.
    expect(seen).toEqual({ key: "assets.logo", client: "web", file: expect.any(String) })
    expect(screen.getByText("All changes saved.")).toBeInTheDocument()
  })

  it("keeps an uploaded signature and an unsaved signatory edit through the next save", async () => {
    const bodies = capturePuts()
    const newPath = "assets/sign-ops-abcdef123456.png"
    server.use(
      http.post("*/api/brands/:id/assets/:key", () => {
        const signatories = (acmeFile["signatories"] as Array<Record<string, string>>).map((s) => (s["id"] === "ops" ? { ...s, signature: newPath } : s))
        const file = { ...acmeFile, signatories }
        return HttpResponse.json({ key: "signature:ops", path: newPath, sha256: "abcdef", bytes: 4, brand: { ...brandDetails["acme"], file } })
      }),
    )
    const { user } = await openEditor("/settings/brands/acme?tab=signatories")
    const name = screen.getByLabelText("Name (signatory 1)")
    await user.clear(name)
    await user.type(name, "Alex Q. Example")
    // Edited fields survive the reload after an upload (keepDirtyValues), the signature path among them unless it is
    // set from the upload; a new row must survive too.
    const sig = screen.getByLabelText("Signature image (signatory 1)")
    await user.clear(sig)
    await user.type(sig, "assets/typed.png")
    await user.click(screen.getByRole("button", { name: "Add signatory" }))
    await user.type(screen.getByLabelText("Id (signatory 3)"), "cfo")
    await user.type(screen.getByLabelText("Name (signatory 3)"), "Casey Example")
    await user.type(screen.getByLabelText("Title (signatory 3)"), "CFO")
    await user.click(screen.getByRole("tab", { name: "Assets" }))
    await screen.findByRole("group", { name: "Signature: ops" })
    await user.upload(screen.getByLabelText("Upload Signature: ops"), new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "s.png", { type: "image/png" }))
    expect(await screen.findByText("Signature: ops uploaded")).toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    const ops = (bodies[0]!["signatories"] as Array<Record<string, string>>)[0]
    expect(ops).toMatchObject({ id: "ops", name: "Alex Q. Example", signature: newPath })
    expect((bodies[0]!["signatories"] as unknown[])[2]).toEqual({ id: "cfo", name: "Casey Example", title: "CFO" })
  })

  it("takes the signatories the server copied into an inheriting brand on a signature upload", async () => {
    const bodies = capturePuts()
    const newPath = "assets/sign-ops-abcdef123456.png"
    const copied = (acmeFile["signatories"] as Array<Record<string, string>>).map((s) => (s["id"] === "ops" ? { ...s, signature: newPath } : s))
    server.use(
      http.post("*/api/brands/:id/assets/:key", () =>
        HttpResponse.json({ key: "signature:ops", path: newPath, sha256: "abcdef", bytes: 4, brand: { ...brandDetails["acme-studio"], file: { ...brandDetails["acme-studio"]!.file, signatories: copied } } }),
      ),
    )
    const { user } = await openEditor("/settings/brands/acme-studio?tab=assets")
    await screen.findByRole("group", { name: "Signature: ops" })
    await user.upload(screen.getByLabelText("Upload Signature: ops"), new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "s.png", { type: "image/png" }))
    expect(await screen.findByText("Signature: ops uploaded")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Signatories" }))
    expect(screen.getByRole("switch", { name: "Override the inherited list" })).toBeChecked()
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]!["signatories"]).toEqual(copied)
  })

  it("adopts brand.json's new file hash after an upload, so the next save is not refused", async () => {
    const matches: Array<string | null> = []
    const uploadedHash = "77".repeat(32)
    server.use(
      http.post("*/api/brands/:id/assets/:key", () => {
        const file = { ...acmeFile, assets: { logo: "assets/logo-abcdef123456.png", seal: "assets/seal.png" } }
        return HttpResponse.json({
          key: "assets.logo", path: "assets/logo-abcdef123456.png", sha256: "abcdef", bytes: 4, fileHash: uploadedHash,
          brand: { ...brandDetails["acme"], file, fileHash: uploadedHash },
        })
      }),
      http.put("*/api/brands/:id", async ({ request }) => {
        matches.push(request.headers.get("If-Match"))
        return HttpResponse.json({ ...brandDetails["acme"], file: await request.json(), fileHash: "88".repeat(32) })
      }),
    )
    const { user } = await openEditor("/settings/brands/acme?tab=assets")
    await screen.findByRole("group", { name: "Logo" })
    await user.upload(screen.getByLabelText("Upload Logo"), new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "l.png", { type: "image/png" }))
    await waitFor(() => expect(screen.getByLabelText("Logo path")).toHaveValue("assets/logo-abcdef123456.png"))
    await user.click(screen.getByRole("tab", { name: "Identity" }))
    const name = screen.getByLabelText("Short name *")
    await user.clear(name)
    await user.type(name, "Acme")
    await user.click(saveButton())
    await waitFor(() => expect(matches).toEqual([`"${uploadedHash}"`]))
  })

  it("reports a file that is too large without uploading, and a 413 from the server", async () => {
    let calls = 0
    server.use(
      http.post("*/api/brands/:id/assets/:key", () => {
        calls += 1
        return HttpResponse.json({ code: "ASSET_TOO_LARGE", message: "Assets are limited to 10 MB", details: {} }, { status: 413 })
      }),
    )
    const { user } = await openEditor("/settings/brands/acme?tab=assets")
    await screen.findByRole("group", { name: "Seal" })
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" })
    await user.upload(screen.getByLabelText("Upload Seal"), big)
    expect(await screen.findByText("Seal: the file is too large")).toBeInTheDocument()
    expect(calls).toBe(0)

    await user.upload(screen.getByLabelText("Upload Watermark"), new File([new Uint8Array(8)], "w.png", { type: "image/png" }))
    expect(await screen.findByText("Watermark: the file is too large")).toBeInTheDocument()
    expect(calls).toBe(1)
  })
})
