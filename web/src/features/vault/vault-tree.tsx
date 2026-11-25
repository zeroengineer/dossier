import * as React from "react"
import { Link } from "react-router"
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, RotateCwIcon } from "lucide-react"
import { useTreeNode } from "@/api/vault"
import type { TreeNode } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ancestorIds, countDocuments, vaultHref } from "./paths"

interface TreeState {
  selectedId: string
  expanded: ReadonlySet<string>
  setExpanded: (id: string, open: boolean) => void
}

const TreeContext = React.createContext<TreeState | null>(null)

function useTree(): TreeState {
  const state = React.useContext(TreeContext)
  if (!state) throw new Error("useTree outside VaultTree")
  return state
}

/** Indentation per level, as a CSS length (inline style: depth is data, not a fixed class). */
const indent = (depth: number) => ({ paddingInlineStart: `${depth * 0.75}rem` })

/**
 * The folder tree. Each folder's children load lazily (`GET /api/tree?node=<id>`) the first time it is expanded; the
 * folders above `selectedId` start expanded so deep links open on the selected folder.
 */
export function VaultTree({ selectedId, className }: { selectedId: string; className?: string }) {
  const [expanded, setExpandedSet] = React.useState<ReadonlySet<string>>(() => new Set(ancestorIds(selectedId)))
  const [seenSelected, setSeenSelected] = React.useState(selectedId)
  if (seenSelected !== selectedId) {
    // Navigating to another folder (link, breadcrumb, back button) reveals it: expand its ancestors.
    setSeenSelected(selectedId)
    const missing = ancestorIds(selectedId).filter((id) => !expanded.has(id))
    if (missing.length) setExpandedSet(new Set([...expanded, ...missing]))
  }

  const setExpanded = React.useCallback((id: string, open: boolean) => {
    setExpandedSet((prev) => {
      if (prev.has(id) === open) return prev
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const state = React.useMemo(() => ({ selectedId, expanded, setExpanded }), [selectedId, expanded, setExpanded])

  return (
    <TreeContext.Provider value={state}>
      <nav aria-label="Folders" className={cn("flex flex-col text-sm", className)}>
        <FolderChildren id="" depth={0} />
      </nav>
    </TreeContext.Provider>
  )
}

/** The subfolders of `id`, fetched when this list mounts (i.e. when the folder is expanded). */
function FolderChildren({ id, depth }: { id: string; depth: number }) {
  const { data, isPending, isError, error, refetch } = useTreeNode(id)

  if (isPending) {
    return (
      <div className="flex flex-col gap-1 py-1" style={indent(depth)} aria-busy="true" aria-label="Loading folders">
        {Array.from({ length: depth === 0 ? 6 : 2 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-3/4" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="flex items-center gap-2 py-1 text-xs text-muted-foreground" style={indent(depth)}>
        <span className="truncate">{errorMessage(error)}</span>
        <Button variant="ghost" size="icon-xs" onClick={() => void refetch()} aria-label="Retry loading folders">
          <RotateCwIcon />
        </Button>
      </div>
    )
  }

  if (!data.children.length) {
    return depth === 0 ? <p className="px-2 py-1 text-muted-foreground">No folders yet.</p> : null
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {data.children.map((child) => (
        <FolderItem key={child.id} node={child} depth={depth} />
      ))}
    </ul>
  )
}

/**
 * One folder row: an expand toggle (only when it has subfolders) and a link selecting it. `node` is the summary from
 * the parent's response; its own subfolders are fetched by `FolderChildren` once expanded.
 */
function FolderItem({ node, depth }: { node: TreeNode; depth: number }) {
  const { selectedId, expanded, setExpanded } = useTree()
  const open = expanded.has(node.id)
  const selected = node.id === selectedId
  const hasChildren = node.children.length > 0
  const count = countDocuments(node)
  const Icon = open && hasChildren ? FolderOpenIcon : FolderIcon

  return (
    <li>
      <Collapsible open={hasChildren && open} onOpenChange={(o) => setExpanded(node.id, o)}>
        <div
          data-selected={selected || undefined}
          className="flex items-center gap-1 rounded-md pr-2 hover:bg-accent hover:text-accent-foreground data-selected:bg-accent data-selected:font-medium data-selected:text-accent-foreground"
          style={indent(depth)}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}>
                <ChevronRightIcon className={cn("motion-safe:transition-transform", open && "rotate-90")} />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <span aria-hidden className="size-6 shrink-0" />
          )}
          <Link
            to={vaultHref(node.id)}
            aria-current={selected ? "page" : undefined}
            onClick={() => hasChildren && setExpanded(node.id, true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{node.name}</span>
            {count ? <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span> : null}
          </Link>
        </div>
        {hasChildren ? (
          <CollapsibleContent>
            <FolderChildren id={node.id} depth={depth + 1} />
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </li>
  )
}
