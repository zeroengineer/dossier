import { Link } from "react-router"
import type { DocumentSummary } from "@/api/types"
import { DateText } from "@/components/date-text"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/** The documents updated last: number, title (links to the document), status and date. */
export function RecentDocuments({ documents }: { documents: DocumentSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent documents</CardTitle>
        <CardDescription>The last {documents.length} documents updated</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/documents">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden text-right md:table-cell">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium tabular-nums">{doc.docNumber ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="max-w-64">
                  <Link to={`/documents/${encodeURIComponent(doc.id)}`} className="block truncate hover:underline">
                    {doc.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={doc.status} />
                </TableCell>
                <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                  <DateText value={doc.docDate ?? doc.updatedAt} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
