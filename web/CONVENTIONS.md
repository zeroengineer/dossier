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
  skeleton rows, empty state, `mode="client" | "server"`, see below),
  `DataTableToolbar` (search slot, filter slots, Reset, View menu), `DataTableFacetedFilter` (client `column` or
  controlled `selected`/`onSelectedChange` for URL params; `facetFilterFn` for client columns),
  `DataTableColumnHeader` (sort/hide menu), `DataTableViewOptions`, `DataTablePagination`. Per-column
  `meta: { label, className }` sets the View-menu label and responsive classes (`hidden md:table-cell`).
- App components: `page-header`, `empty-state`, `error-state`, `status-badge`, `sensitivity-badge`, `money`,
  `date-text`, `page-skeleton`, `confirm-dialog` (`ConfirmDialog`: every destructive or irreversible action; title,
  description, `confirmLabel`, outlined red confirm, async `onConfirm` with a pending state, closes on success and
  stays open on failure; `trigger` or controlled `open`/`onOpenChange`).

### Data table modes

- **Client mode** (default): pass every row in `data`. Sorting, search, faceted filters and pagination run in the
  table, and any new sort, search, filter or Reset goes back to page 1.
- **Server mode** (the documents list, anything paged by the API): pass `mode="server"` plus controlled `pagination`
  / `onPaginationChange`, `sorting` / `onSortingChange` (if sortable), and `rowCount` = the API total (it may be
  undefined while the first page loads; the table stays in server mode). `data` is the current page as returned.
  You own the page index: when search, filters or sort change, set `pageIndex` to 0 yourself (usually in the same URL
  search-params update). Keep the previous page on screen while the next one loads with
  `useQuery({ ..., placeholderData: keepPreviousData })` and pass `isLoading` only for the very first load.
  Use controlled `search` / `selected` props on the toolbar and faceted filters (URL params), not column filters.
- Clickable rows (`onRowClick`) activate on click, Enter and Space and show a focus ring. The primary cell (title or
  number) should still render a real `<Link>` to the target so it can be opened in a new tab and is announced as a
  link; the row click ignores clicks on links and buttons inside it.
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

## Layout rhythm

One spacing scale for every page (Tailwind steps, no arbitrary values):

- **Shell.** The sidebar floats (`variant="floating"`, `collapsible="icon"`): inset 0.5rem from the window, rounded,
  `shadow-lg`. The sticky header floats with it: `h-12`, `rounded-xl`, border, backdrop blur, `shadow-md` once the page
  scrolls under it. Header and page share the sidebar's inset, so their edges line up with the sidebar's top and
  bottom: `px-3 pt-3` on phones, `pt-2 pr-2` from `md`. The left gutter from `md` is 0.75rem (header `pl-3`, page
  `ml-3`, so the page's own box starts after it): the sidebar's resize rail reaches up to 10 px past the sidebar gap
  in the icon rail (8 px expanded), and nothing of the page may sit under it.
- **Page.** `#main-content` is a `flex flex-col gap-6` column with `pt-6`; a page's own root is `flex flex-col gap-6`
  too: header, toolbar, cards and tables are `gap-6` apart. Do not add page padding of your own.
- **Inside a block.** Toolbar to table and card to card in one group: `gap-4`. Cards keep the card's own spacing
  (`--card-spacing`, 1rem; `size="sm"` 0.75rem); a card body stacks with `gap-4`. Form fields use `FieldGroup`; side
  by side fields use `grid gap-4 sm:grid-cols-2`.
- **Dialogs and sheets** keep the shadcn padding and footer; do not pad their content again.
- **Empty and error states** (`EmptyState`, `ErrorState`) fill the space they are given and centre their content; give
  them a `min-h-*` only when the parent has no height of its own.
- **Floating bars.** Sticky action bars (`SaveBar`, the Generate action row) float like the header: `sticky bottom-2`,
  `rounded-xl`, border, translucent background with blur, `shadow-lg`.
- **Tabs.** A tab list that can outgrow its container uses `ScrollableTabsList` (scrolls sideways with faded edges,
  never wraps). A tab worth linking to lives in the URL (`?kind=`, `?tab=`, `?view=`, default left out, unknown values
  fall back to the default). Panels holding iframes or unsaved input stay mounted once opened (`forceMount` +
  `data-[state=inactive]:hidden`).
- **Numbers.** Numeric columns are `text-right tabular-nums` in header and cells; a sortable numeric header uses
  `DataTableColumnHeader align="end"`.
- **Motion.** 150 to 250 ms, ease-out, defined in `styles/globals.css` (page view transitions, tab, skeleton and row
  fades, sidebar collapse). Everything respects `prefers-reduced-motion`. No animation library.

## Tests

- Tests live next to the feature (`features/<area>/*.test.tsx`, `pages/<page>.test.tsx`), Vitest + Testing Library.
- MSW: put your default handlers in `web/src/test/handlers/<area>.ts` (or `.tsx`) exporting
  `export const handlers = [...]`. `test/handlers/index.ts` picks up every file in that folder automatically, so do
  not edit it; a file there without a `handlers` array makes every test fail on purpose. Per-test overrides
  use `server.use(...)` from `@/test/server`.
- Fixtures: example workspace data only (Acme Events, Alex Example, `ACM-` numbers, example.com/org/net). Put
  area fixtures in your own file (e.g. `test/fixtures-<area>.ts`), not in `test/fixtures.ts`.
- Before you finish: `npm test`, `npm run typecheck`, `npm run build`, `node scripts/org-data-guard.js` from the repo
  root, all green.
