import { useMe } from "@/api/me"
import { useMeta } from "@/api/meta"
import { useWorkspaceFile } from "@/api/settings"
import { ErrorState } from "@/components/error-state"
import { PageSkeleton } from "@/components/page-skeleton"
import { SettingsPage } from "@/features/settings/settings-page"
import { WorkspaceEditor } from "@/features/settings/workspace/workspace-editor"

export default function WorkspaceSettingsPage() {
  const file = useWorkspaceFile()
  const meta = useMeta()
  const me = useMe()
  const failed = file.isError ? file : meta.isError ? meta : null

  return (
    <SettingsPage title="Workspace" description="Workspace name, default brand, locale, folder hierarchy, users and clearance.">
      {failed ? (
        <ErrorState error={failed.error} title="Could not load workspace.json" onRetry={() => void failed.refetch()} />
      ) : file.data && meta.data ? (
        <WorkspaceEditor
          file={file.data}
          brandIds={me.data?.brands.map((b) => b.id) ?? []}
          locale={me.data?.workspace.locale ?? null}
          myClearance={me.data?.user.clearance ?? null}
          clearances={meta.data.clearances}
          defaultTopLevel={meta.data.hierarchy.topLevel}
          topKeys={meta.data.hierarchy.topKeys}
        />
      ) : (
        <PageSkeleton />
      )}
    </SettingsPage>
  )
}
