import * as React from "react"

/**
 * `value` while `active`; while inactive, the last value seen when it was active. A hidden tab panel uses it so its
 * frame keeps the page it shows (no reload in the background) and picks up the newest value when it is shown again.
 */
export function useLatchedWhileActive<T>(value: T, active: boolean): T {
  const latched = React.useRef(value)
  if (active) latched.current = value
  return latched.current
}
