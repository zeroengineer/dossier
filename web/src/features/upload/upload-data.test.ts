import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api"
import { erroredFields, formatBytes, isTooLarge, levelsWithin, toUploadFormData, uploadErrorMessage, warningMessage, warningTitle } from "./upload-data"

const levels = ["Public", "Internal", "Confidential", "Restricted"] as const

describe("upload data helpers", () => {
  it("builds the multipart body from the file and the non-blank, trimmed fields", () => {
    const file = new File(["hello"], "scan.pdf", { type: "application/pdf" })
    const body = toUploadFormData(file, { type: " invoice ", title: "", docNumber: "ACM-2026-0001", makeCurrent: false })
    expect([...body.keys()]).toEqual(["type", "docNumber", "makeCurrent", "file"])
    expect(body.get("type")).toBe("invoice")
    expect(body.get("makeCurrent")).toBe("false")
    expect((body.get("file") as File).name).toBe("scan.pdf")
  })

  it("offers sensitivity levels up to the user's clearance", () => {
    expect(levelsWithin([...levels], "Internal")).toEqual(["Public", "Internal"])
    expect(levelsWithin([...levels], "Restricted")).toEqual([...levels])
    expect(levelsWithin([...levels], undefined)).toEqual([...levels])
  })

  it("formats byte limits", () => {
    expect(formatBytes(52428800)).toBe("50 MB")
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB")
    expect(formatBytes(2048)).toBe("2 KB")
  })

  it("turns the 413 size-limit answer into a plain sentence and keeps CODE: message otherwise", () => {
    const tooLarge = new ApiError(413, { code: "PAYLOAD_TOO_LARGE", message: "request file too large", details: {} })
    expect(isTooLarge(tooLarge)).toBe(true)
    expect(uploadErrorMessage(tooLarge, 52428800)).toBe("The file is larger than the 50 MB upload limit. Choose a smaller file.")
    const forbidden = new ApiError(403, { code: "FORBIDDEN", message: "cannot file a Restricted document", details: {} })
    expect(uploadErrorMessage(forbidden, 52428800)).toBe("FORBIDDEN: cannot file a Restricted document")
  })

  it("finds the form fields a server error names in its details", () => {
    const fields = ["type", "amount", "currency", "partyId"] as const
    const err = new ApiError(400, { code: "INVALID_INPUT", message: "currency is required with amountMinor", details: { amountMinor: 100, currency: "x" } })
    expect(erroredFields(err, fields)).toEqual(["amount", "currency"])
    expect(erroredFields(new Error("boom"), fields)).toEqual([])
  })

  it("explains a number conflict", () => {
    expect(warningMessage("NUMBER_CONFLICT", "ACM-2026-0007", "invoice-main")).toBe(
      "Number ACM-2026-0007 is already used in series invoice-main. The document is flagged with a number conflict.",
    )
    expect(warningMessage("OTHER", null, null)).toBe("OTHER")
    expect(warningTitle("NUMBER_CONFLICT")).toBe("Number conflict")
    expect(warningTitle("BRAND_ASSET_MISSING")).toBe("Brand asset missing")
  })
})
