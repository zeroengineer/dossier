import type { RequestHandler } from "msw"

/**
 * Default API handlers, collected from every sibling `<area>.ts` / `<area>.tsx` that exports `handlers` (core.ts:
 * /api/me and /api/meta). Add a file per feature area instead of editing this one; tests override per case with
 * `server.use(...)`. A matched file without a `handlers` array is an error, so a typo cannot silently drop handlers.
 */
const modules = import.meta.glob<{ handlers?: unknown }>(
  ["./*.{ts,tsx}", "!./index.ts", "!./*.test.{ts,tsx}"],
  { eager: true },
)

export const handlers: RequestHandler[] = Object.keys(modules)
  .sort()
  .flatMap((path) => {
    const exported = modules[path]?.handlers
    if (!Array.isArray(exported)) {
      throw new Error(`MSW handler module ${path} must export \`handlers\` (an array of request handlers)`)
    }
    return exported as RequestHandler[]
  })
