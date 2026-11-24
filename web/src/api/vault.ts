import { useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api"
import type { TreeNode } from "./types"

/** Query keys for the folder tree (prefix `tree`, so `treeKeys.all` invalidates every node). */
export const treeKeys = {
  all: ["tree"] as const,
  node: (id: string) => ["tree", "node", id] as const,
}

/** One folder with its subtree; `''` is the root. Unknown ids answer 404 `NODE_NOT_FOUND`. */
export const fetchTreeNode = (id: string, signal?: AbortSignal) =>
  request<TreeNode>("/api/tree", { query: { node: id }, signal })

/** A tree node, fetched only while `enabled` (folders load lazily as they are expanded). */
export function useTreeNode(id: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: treeKeys.node(id), queryFn: ({ signal }) => fetchTreeNode(id, signal), enabled })
}
