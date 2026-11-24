import { Link } from "react-router"
import type { SeriesCounter } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/** Numbering counters: the series, its counter key and the next number it hands out. */
export function SeriesCounters({ counters, numberLocale }: { counters: SeriesCounter[]; numberLocale: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Series counters</CardTitle>
        <CardDescription>Next number per counter</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings/numbering">Manage</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {counters.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Series</TableHead>
                <TableHead>Counter</TableHead>
                <TableHead className="text-right">Next</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counters.map((c) => (
                <TableRow key={`${c.seriesId}:${c.key}`}>
                  <TableCell className="font-medium">{c.seriesId}</TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">{c.key}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.value.toLocaleString(numberLocale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No document has been numbered yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
