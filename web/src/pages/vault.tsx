import { useParams } from "react-router"
import { PageHeader } from "@/components/page-header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { FolderDocuments } from "@/features/vault/folder-documents"
import { normalizeNodeId } from "@/features/vault/paths"
import { VaultTree } from "@/features/vault/vault-tree"
import { useIsMobile } from "@/hooks/use-mobile"

/** `/vault` and `/vault/*`: the splat is the selected folder's id (`03/events/acme/invoices`). */
export default function VaultPage() {
  const nodeId = normalizeNodeId(useParams()["*"])
  const isMobile = useIsMobile()

  const tree = <VaultTree selectedId={nodeId} className="p-2" />
  const documents = <FolderDocuments key={nodeId} nodeId={nodeId} />

  return (
    <>
      <PageHeader title="Vault" description="Browse documents in the folder tree computed from their metadata." />
      {isMobile ? (
        <div className="flex flex-col gap-4">
          <ScrollArea className="h-72 rounded-lg border bg-card shadow-md">{tree}</ScrollArea>
          {documents}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-[32rem] flex-1 rounded-lg border bg-card shadow-md"
        >
          <ResizablePanel defaultSize="28" minSize="18" maxSize="50">
            <ScrollArea className="h-full">{tree}</ScrollArea>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="72" minSize="40">
            <ScrollArea className="h-full">
              <div className="p-4 md:p-6">{documents}</div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </>
  )
}
