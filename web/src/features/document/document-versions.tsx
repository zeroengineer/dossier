import type { DocumentVersion } from "@/api/types"
import { DateText } from "@/components/date-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { KIND_LABEL, VIEWER_KINDS } from "./renditions"

interface DocumentVersionsProps {
  versions: DocumentVersion[]
  /** The version on show in the viewer. */
  selected: number | null
  onSelect: (versionNo: number) => void
}

/** Every version, newest first; choosing one drives the viewer. */
export function DocumentVersions({ versions, selected, onSelect }: DocumentVersionsProps) {
  const rows = [...versions].sort((a, b) => b.versionNo - a.versionNo)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
        <CardDescription>Choose a version to show it in the preview.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table aria-label="Versions">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Version</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="hidden md:table-cell">By</TableHead>
                <TableHead className="hidden md:table-cell">Note</TableHead>
                <TableHead>Files</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => {
                const active = v.versionNo === selected
                return (
                  <TableRow
                    key={v.id}
                    data-state={active ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => onSelect(v.versionNo)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                          aria-pressed={active}
                          aria-label={`Show version ${v.versionNo}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelect(v.versionNo)
                          }}
                        >
                          v{v.versionNo}
                        </Button>
                        {v.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell><DateText value={v.createdAt} style="datetime" /></TableCell>
                    <TableCell className="hidden md:table-cell">{v.createdBy ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden max-w-64 truncate md:table-cell">
                      {v.note ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {VIEWER_KINDS.filter((k) => v.renditions.some((r) => r.kind === k)).map((k) => (
                          <Badge key={k} variant="outline">{KIND_LABEL[k]}</Badge>
                        ))}
                        {v.renditions.length === 0 ? <span className="text-muted-foreground">None</span> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground">No versions yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
