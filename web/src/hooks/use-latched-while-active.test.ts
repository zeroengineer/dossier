import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useLatchedWhileActive } from "./use-latched-while-active"

describe("useLatchedWhileActive", () => {
  it("follows the value while active, holds the last active value while inactive, and catches up when active again", () => {
    const { result, rerender } = renderHook(({ value, active }) => useLatchedWhileActive(value, active), {
      initialProps: { value: "a", active: true },
    })
    expect(result.current).toBe("a")
    rerender({ value: "b", active: true })
    expect(result.current).toBe("b")
    rerender({ value: "c", active: false })
    expect(result.current).toBe("b")
    rerender({ value: "d", active: false })
    expect(result.current).toBe("b")
    rerender({ value: "d", active: true })
    expect(result.current).toBe("d")
  })

  it("starts from the first value even when first rendered inactive", () => {
    const { result } = renderHook(() => useLatchedWhileActive(1, false))
    expect(result.current).toBe(1)
  })
})
