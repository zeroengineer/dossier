import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Highlighted, splitSnippet } from "./highlight"

describe("splitSnippet", () => {
  it("splits marked terms out of the text", () => {
    expect(splitSnippet("…pay [Acme] Events by [April]…")).toEqual([
      { text: "…pay ", mark: false },
      { text: "Acme", mark: true },
      { text: " Events by ", mark: false },
      { text: "April", mark: true },
      { text: "…", mark: false },
    ])
  })

  it("returns plain text without markers as one part", () => {
    expect(splitSnippet("no markers here")).toEqual([{ text: "no markers here", mark: false }])
    expect(splitSnippet("")).toEqual([])
  })

  it("keeps unpaired brackets as text and joins adjacent marks", () => {
    expect(splitSnippet("a ] b [c")).toEqual([{ text: "a ] b [c", mark: false }])
    expect(splitSnippet("[Ac][me] x")).toEqual([{ text: "Acme", mark: true }, { text: " x", mark: false }])
  })
})

describe("Highlighted", () => {
  it("wraps matches in <mark> and renders markup in the text as text", () => {
    const { container } = render(<Highlighted snippet={'<b onclick="x">bold</b> [Acme]'} />)
    expect(container.querySelector("b")).toBeNull()
    expect(container.textContent).toBe('<b onclick="x">bold</b> Acme')
    const marks = container.querySelectorAll("mark")
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent("Acme")
  })
})
