import type * as React from "react"
import { Link } from "react-router"
import type { EntityDetail } from "@/api/types"
import { DateText } from "@/components/date-text"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { kindLabel } from "./labels"

const NONE = <span className="text-muted-foreground">—</span>

function Row({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "flex flex-col gap-0.5 sm:col-span-2" : "flex flex-col gap-0.5"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** An attribute value: strings as they are, anything else as compact JSON. */
const attrText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v))

/** Read-only entity details: id, kind, aliases, brand, document count, attributes and audit dates. */
export function EntityDetails({ entity }: { entity: EntityDetail }) {
  const attrs = Object.entries(entity.attrs)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Entity details">
          <Row label="Id"><span className="tabular-nums">{entity.id}</span></Row>
          <Row label="Kind">{kindLabel(entity.kind)}</Row>
          <Row label="Aliases" wide>
            {entity.aliases.length ? (
              <span className="flex flex-wrap gap-1.5">
                {entity.aliases.map((a) => (
                  <Badge key={a} variant="secondary">{a}</Badge>
                ))}
              </span>
            ) : NONE}
          </Row>
          <Row label="Brand">
            {entity.brand ? (
              <Link to={`/settings/brands/${encodeURIComponent(entity.brand)}`} className="underline-offset-4 hover:underline">
                {entity.brand}
              </Link>
            ) : NONE}
          </Row>
          <Row label="Documents"><span className="tabular-nums">{entity.documentCount}</span></Row>
          <Row label="Created"><DateText value={entity.createdAt} style="datetime" /></Row>
          <Row label="Last updated"><DateText value={entity.updatedAt} style="datetime" /></Row>
          <Row label="Attributes" wide>
            {attrs.length ? (
              <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg border p-3 text-sm" aria-label="Attributes">
                {attrs.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-xs leading-5 text-muted-foreground">{k}</dt>
                    <dd className="break-words">{attrText(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : NONE}
          </Row>
        </dl>
      </CardContent>
    </Card>
  )
}
