import { describe, expect, it } from "vitest"
import { emptyDoc, invoiceDoc } from "@/test/fixtures-document"
import { formatBytes, originalPreview, parseVersionParam, pickVersion, viewerRenditions } from "./renditions"

describe("document renditions helpers", () => {
  it("picks the requested version, else the current one, else the newest", () => {
    expect(pickVersion(invoiceDoc, 1)?.versionNo).toBe(1)
    expect(pickVersion(invoiceDoc, null)?.versionNo).toBe(2)
    expect(pickVersion(invoiceDoc, 9)?.versionNo).toBe(2)
    const noCurrent = { versions: invoiceDoc.versions.map((v) => ({ ...v, isCurrent: false })) }
    expect(pickVersion(noCurrent, null)?.versionNo).toBe(2)
    expect(pickVersion(emptyDoc, null)).toBeNull()
  })

  it("orders a version's renditions PDF, HTML, Markdown, original", () => {
    const v1 = invoiceDoc.versions[0] ?? null
    expect(viewerRenditions(v1).map((r) => r.kind)).toEqual(["pdf", "html", "md"])
    expect(viewerRenditions(null)).toEqual([])
  })

  it("reads ?version= as a positive integer only", () => {
    expect(parseVersionParam("3")).toBe(3)
    expect(parseVersionParam("0")).toBeNull()
    expect(parseVersionParam("x")).toBeNull()
    expect(parseVersionParam(null)).toBeNull()
  })

  it("decides how an original file previews", () => {
    expect(originalPreview("application/pdf")).toBe("pdf")
    expect(originalPreview("text/html; charset=utf-8")).toBe("html")
    expect(originalPreview("image/png")).toBe("image")
    expect(originalPreview("text/plain")).toBe("text")
    expect(originalPreview("application/zip")).toBeNull()
  })

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
  })
})
