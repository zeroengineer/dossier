import * as React from "react"

/** Default delay for search-as-you-type lookups (party pickers and filters). */
export const DEBOUNCE_MS = 250

/** `value`, updated only after it has stopped changing for `ms` milliseconds. */
export function useDebounced<T>(value: T, ms: number = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
