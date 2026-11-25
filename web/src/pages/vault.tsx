import { useParams } from "react-router"
import { PageHeader } from "@/components/page-header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { FolderDocuments } from "@/features/vault/folder-documents"
import { normalizeNodeId } from "@/features/vault/paths"
import { VaultTree } from "@/features/vault/vault-tree"
import { cn } from "@/lib/utils"

/**
 * Below `md` the two panes stack (tree above, documents below) by CSS alone, so the tree and the folder's documents
 * mount once whatever the width (no layout swap after the first paint). The panel library sets its flex layout as
 * inline styles, hence the `!` overrides. This depends on react-resizable-panels 4.x putting those inline styles on
 * the group and on each panel's outer `[data-panel]` div (the className goes to an inner div); recheck it on upgrade.
 */
const STACK_BELOW_MD =
  "max-md:h-auto! max-md:flex-col! max-md:overflow-visible! max-md:[&>[data-panel]]:flex-none! max-md:[&>[data-panel]]:max-h-none!"

/** `/vault` and `/vault/*`: the splat is the selected folder's id (`03/events/acme/invoices`). */
export default function VaultPage() {
  const nodeId = normalizeNodeId(useParams()["*"])

  return (
    <>
      <PageHeader title="Vault" description="Browse documents in the folder tree computed from their metadata." />
      <ResizablePanelGroup
        orientation="horizontal"
        className={cn("flex-1 rounded-lg border bg-card shadow-md md:min-h-128", STACK_BELOW_MD)}
      >
        <ResizablePanel defaultSize="28" minSize="18" maxSize="50" className="max-md:h-72 max-md:border-b">
          <ScrollArea className="h-full">
            <VaultTree selectedId={nodeId} className="p-2" />
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle className="max-md:hidden" />
        <ResizablePanel defaultSize="72" minSize="40">
          {/* A plain scroller (not ScrollArea, whose table wrapper has no height) so an empty state can fill and centre. */}
          <div className="h-full overflow-y-auto">
            <div className="flex min-h-full flex-col p-4 md:p-6">
              <FolderDocuments key={nodeId} nodeId={nodeId} />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  )
}
