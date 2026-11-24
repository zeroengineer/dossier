# Web app conventions for parallel feature work

Binding for every phase 2 feature task. Read with `.superpowers/sdd/UI/global.md`, PLAN-UI and the shadcn skill
(`.claude/skills/shadcn/SKILL.md`, `rules/*.md`).

## Where code goes

- Feature code: `web/src/features/<area>/` (components, hooks, schemas, helpers). The route's page:
  `web/src/pages/<page>.tsx` (replace the placeholder body; keep the default export).
- API calls: `web/src/api/<area>.ts`, one file per area (fetchers + TanStack Query hooks, like `api/meta.ts`).
  Use the existing query keys in `lib/keys.ts`; if your area needs more, define them in your `api/<area>.ts`
  starting with the resource name (prefix invalidation) instead of editing `lib/keys.ts`.
- Types: `web/src/api/types.ts` is append-only. Add your shapes at the end under a `// <area>` comment; never
  reorder or rename existing ones. Mirror the backend (`src/web/routes/*.js`, `src/services/*.js`) exactly, nullables
  explicit. `DocumentSummary` and the dashboard types are already there.
- `router.tsx`: only touch your route, and only to swap its placeholder component / lazy import. Pages are already
  wired with `React.lazy(() => import("@/pages/<page>"))`, so usually no router change is needed at all.

## Files you must not edit

`package.json`, `web/package.json`, `package-lock.json`, `CHANGELOG.md`, `docs/DECISIONS.md`, `README.md`. Every
library you need is installed (below). If you need another dependency, or made a decision worth recording, write it in
your task report; the lead adds changelog and decision entries.

Also leave the shared components below and `components/ui/*` as they are; if one needs a change, report it.

## Reuse before you build

- `components/data-table/*` (import from `@/components/data-table`): `DataTable` (TanStack Table v8, row click,
  skeleton rows, empty state, client or manual server-side pagination via `rowCount`, manual sorting),
  `DataTableToolbar` (search slot, filter slots, Reset, View menu), `DataTableFacetedFilter` (client `column` or
  controlled `selected`/`onSelectedChange` for URL params; `facetFilterFn` for client columns),
  `DataTableColumnHeader` (sort/hide menu), `DataTableViewOptions`, `DataTablePagination`. Per-column
  `meta: { label, className }` sets the View-menu label and responsive classes (`hidden md:table-cell`).
- App components: `page-header`, `empty-state`, `error-state`, `status-badge`, `sensitivity-badge`, `money`,
  `date-text`, `page-skeleton`.
- shadcn (`components/ui`): accordion, alert, alert-dialog, avatar, badge, breadcrumb, button, button-group, calendar,
  card, chart, checkbox, collapsible, combobox, command, context-menu, dialog, dropdown-menu, empty, field,
  hover-card, input, input-group, item, kbd, label, native-select, navigation-menu, pagination, popover, progress,
  radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, spinner, switch, table,
  tabs, textarea, toggle, toggle-group, tooltip. Base is Radix (`asChild`, `ToggleGroup type="single"`).
- Libraries: `@tanstack/react-table` v8, `@tanstack/react-query` v5, `react-hook-form` + `@hookform/resolvers` +
  `zod` v4 (forms: `Field`/`FieldGroup`/`FieldError` from `components/ui/field` with `Controller`; there is no
  separate shadcn `form` component), `date-fns` v4, `recharts` v3 via `components/ui/chart`, `react-day-picker`
  (Calendar), `react-resizable-panels` (Resizable), `lucide-react`, `sonner`.

## Styling

Semantic tokens only (`bg-card`, `text-muted-foreground`, `border`, ...); no raw colours, no `dark:` overrides. Red
(`--primary`) is the only accent; destructive actions are outlined red behind an AlertDialog confirm. Charts: give
`ChartConfig` colours as `var(--chart-1)` ... `var(--chart-5)` (`--chart-1` is the red). `gap-*` not `space-*`,
`size-*`, `cn()`, built-in variants, `data-icon` on icons in buttons.

## Tests

- Tests live next to the feature (`features/<area>/*.test.tsx`, `pages/<page>.test.tsx`), Vitest + Testing Library.
- MSW: put your default handlers in `web/src/test/handlers/<area>.ts` exporting `export const handlers = [...]`.
  `test/handlers/index.ts` picks up every file in that folder automatically, so do not edit it. Per-test overrides
  use `server.use(...)` from `@/test/server`.
- Fixtures: example workspace data only (Acme Events, Alex Example, `ACM-` numbers, example.com/org/net). Put
  area fixtures in your own file (e.g. `test/fixtures-<area>.ts`), not in `test/fixtures.ts`.
- Before you finish: `npm test`, `npm run typecheck`, `npm run build`, `node scripts/org-data-guard.js` from the repo
  root, all green.
