import * as React from "react"
import { TabsList } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * A `TabsList` that scrolls sideways (scrollbar hidden) when its tabs do not fit, instead of wrapping out of its pill
 * on narrow screens. The edge with more tabs behind it fades out, and the active tab is kept in view, also when it
 * comes from the URL on load.
 */
export function ScrollableTabsList({ className, children, ...props }: React.ComponentProps<typeof TabsList>) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = React.useState({ start: false, end: false })

  const measure = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  // Scroll the active tab into view only when the active tab changes (or first appears), so a list the user scrolled
  // by hand stays where it is across unrelated re-renders.
  const scrolledFor = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    const scroller = ref.current
    const active = scroller?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    const key = active ? (active.id || active.textContent) : null
    if (scroller && active && key !== scrolledFor.current) {
      scrolledFor.current = key
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      if (left < scroller.scrollLeft) scroller.scrollLeft = left
      else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth
    }
    measure()
  })

  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div
      ref={ref}
      data-slot="tabs-scroller"
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
      onScroll={measure}
      className="scrollbar-none relative -m-1 overflow-x-auto p-1 data-overflow-end:mask-r-from-85% data-overflow-start:mask-l-from-85%"
    >
      <TabsList className={cn("w-max", className)} {...props}>
        {children}
      </TabsList>
    </div>
  )
}
