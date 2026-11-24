import type { DocumentDetail } from "@/api/types"

/**
 * The document header's action bar. Empty on purpose in F08 (read-only page): F09 fills it with the status
 * DropdownMenu (`meta.transitions[status]`), metadata edit, Regenerate, Upload new version and link actions.
 */
export function DocumentActions({ doc }: { doc: DocumentDetail }) {
  return <div data-testid="document-actions" data-document={doc.id} className="flex flex-wrap items-center gap-2" />
}
