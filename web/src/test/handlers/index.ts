import type { RequestHandler } from "msw"

/**
 * Default API handlers, collected from every sibling `<area>.ts` that exports `handlers` (core.ts: /api/me and
 * /api/meta). Add a file per feature area instead of editing this one; tests override per case with `server.use(...)`.
 */
const modules = import.meta.glob<{ handlers: RequestHandler[] }>(["./*.ts", "!./index.ts", "!./*.test.ts"], { eager: true })

export const handlers: RequestHandler[] = Object.keys(modules)
  .sort()
  .flatMap((path) => modules[path]?.handlers ?? [])
