import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, beforeAll } from "vitest"
import { server } from "./server"

beforeAll(() => server.listen({ onUnhandledFrame: "error" }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
  window.localStorage.clear()
})
afterAll(() => server.close())

// jsdom lacks these browser APIs that Radix, cmdk and the sidebar's mobile hook use.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// react-resizable-panels hit-tests every document pointerdown against its separators' rects and, on a hit, calls
// preventDefault (which makes Radix triggers ignore the click). jsdom has no layout, so every rect is 0x0 at the origin
// and every click "hits" a separator while a Resizable is mounted. Park separators far off-screen instead.
const getBoundingClientRect = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function boundingClientRect(this: Element) {
  if (this.hasAttribute("data-separator")) return new DOMRect(-100_000, -100_000, 1, 1)
  return getBoundingClientRect.call(this)
}

Element.prototype.scrollIntoView ??= function scrollIntoView() {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}
