import type { TreeNode } from "@/api/types"

/** A node id from the `/vault/*` splat: no leading/trailing or doubled slashes (`''` is the root). */
export function normalizeNodeId(splat: string | undefined): string {
  return (splat ?? "").split("/").filter(Boolean).join("/")
}

/** Client URL of a folder: `/vault/<id>`, each segment URL-encoded (ids are slugs, but stay safe). */
export function vaultHref(id: string): string {
  const path = normalizeNodeId(id).split("/").filter(Boolean).map(encodeURIComponent).join("/")
  return path ? `/vault/${path}` : "/vault"
}

/** Ids of the folders above `id`, outermost first (`a/b/c` → `a`, `a/b`). */
export function ancestorIds(id: string): string[] {
  const segments = normalizeNodeId(id).split("/").filter(Boolean)
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join("/"))
}

/** Depth-first search for a node by id. */
export function findNode(tree: TreeNode, id: string): TreeNode | null {
  if (tree.id === id) return tree
  for (const child of tree.children) {
    if (id === child.id || id.startsWith(`${child.id}/`)) {
      const found = findNode(child, id)
      if (found) return found
    }
  }
  return null
}

/** Documents in a folder and all its subfolders. */
export function countDocuments(node: TreeNode): number {
  return node.children.reduce((sum, child) => sum + countDocuments(child), node.documents.length)
}

export interface FolderCrumb {
  id: string
  name: string
}

/**
 * Breadcrumb trail for a folder, outermost first, ending with the folder itself. Names come from the root tree when
 * it is loaded (folder names may contain `/`); otherwise from the node's `path` when its segments line up with the
 * id's, else just the folder.
 */
export function folderCrumbs(node: TreeNode, root?: TreeNode): FolderCrumb[] {
  const ids = [...ancestorIds(node.id), node.id]
  if (root) {
    const names = ids.map((id) => findNode(root, id)?.name)
    if (names.every((n): n is string => n !== undefined)) return ids.map((id, i) => ({ id, name: names[i] ?? id }))
  }
  const segments = node.path.split("/")
  if (segments.length === ids.length) return ids.map((id, i) => ({ id, name: segments[i] ?? id }))
  return [{ id: node.id, name: node.name }]
}
