import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LogoMark, LogoWordmark } from "@/components/logo"
import { MARK_BOWL, MARK_SPINE, WORDMARK } from "@/components/logo-paths"
import { renderApp } from "@/test/render"

const WEB = path.resolve(import.meta.dirname, "../..")
const read = (rel: string) => readFileSync(path.join(WEB, rel), "utf8")

describe("LogoMark", () => {
  it("draws the bowl in currentColor and the spine as the red accent, as paths only", () => {
    const { container } = render(<LogoMark className="size-6" />)
    const svg = container.querySelector("svg")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg).toHaveAttribute("fill", "currentColor")
    expect(svg).toHaveClass("size-6")
    expect(svg?.querySelector("text")).toBeNull()
    const bowl = svg?.querySelector("[data-part=bowl]")
    const spine = svg?.querySelector("[data-part=spine]")
    expect(bowl).toHaveAttribute("d", MARK_BOWL)
    expect(bowl).not.toHaveAttribute("class")
    expect(spine).toHaveAttribute("d", MARK_SPINE)
    expect(spine).toHaveClass("text-primary")
    expect(spine).toHaveAttribute("fill", "currentColor")
  })

  it("is an image named by its title when it stands alone", () => {
    render(<LogoMark title="Dossier" />)
    expect(screen.getByRole("img", { name: "Dossier" })).toHaveAttribute("data-slot", "logo-mark")
  })
})

describe("LogoWordmark", () => {
  it("draws the outlined wordmark in currentColor, sized by height", () => {
    const { container } = render(<LogoWordmark />)
    const svg = container.querySelector("svg")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg).toHaveAttribute("fill", "currentColor")
    expect(svg).toHaveClass("h-3.5", "w-auto")
    expect(svg?.querySelector("text")).toBeNull()
    expect(svg?.querySelector("path")).toHaveAttribute("d", WORDMARK)
  })
})

describe("sidebar logo", () => {
  it("shows the mark and the wordmark in the home link, and only the mark in the icon rail", async () => {
    const { user } = renderApp("/vault")
    const home = await screen.findByRole("link", { name: "Dossier home" })
    expect(home).toHaveAttribute("href", "/")
    const mark = home.querySelector("[data-slot=logo-mark]")
    const wordmark = home.querySelector("[data-slot=logo-wordmark]")
    expect(mark).not.toBeNull()
    expect(wordmark).not.toBeNull()
    expect(within(home).queryByText("Dossier")).toBeNull()
    // The rail hides the wordmark with the sidebar's collapsible=icon state (CSS); the mark has no such class.
    expect(wordmark).toHaveClass("group-data-[collapsible=icon]:hidden")
    expect(mark?.getAttribute("class")).not.toMatch(/collapsible=icon/)
    const trigger = document.querySelector<HTMLElement>("[data-sidebar=trigger]")
    if (!trigger) throw new Error("no sidebar trigger")
    await user.click(trigger)
    await waitFor(() => expect(document.querySelector("[data-collapsible=icon]")).not.toBeNull())
    expect(document.querySelector("[data-collapsible=icon]")?.contains(wordmark ?? null)).toBe(true)
  })
})

describe("brand kit files", () => {
  it("keeps the inline paths in step with the reversed master and the wordmark master", () => {
    const mark = read("brand-src/kit/dossier-mark-reversed.svg")
    expect(mark).toContain(`d="${MARK_BOWL}"`)
    expect(mark).toContain(`d="${MARK_SPINE}"`)
    expect(read("brand-src/kit/dossier-wordmark.svg")).toContain(`d="${WORDMARK}"`)
  })

  it("links the favicon, icons and manifest from index.html, and every linked file exists", () => {
    const html = read("index.html")
    const hrefs = [...html.matchAll(/<link [^>]*href="([^"]+)"/g)].map((m) => m[1] ?? "")
    expect(hrefs).toEqual(["/favicon.ico", "/brand/favicon.svg", "/brand/apple-touch-icon.png", "/site.webmanifest"])
    for (const href of hrefs) expect(existsSync(path.join(WEB, "public", href)), href).toBe(true)
    expect(html).toContain('<meta name="theme-color" content="#141416" />')
  })

  it("has a manifest whose icons exist under public/brand", () => {
    const manifest = JSON.parse(read("public/site.webmanifest")) as { name: string; icons: { src: string; sizes: string }[] }
    expect(manifest.name).toBe("Dossier")
    expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512", "512x512"])
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^\/brand\//)
      expect(existsSync(path.join(WEB, "public", icon.src)), icon.src).toBe(true)
    }
  })
})
