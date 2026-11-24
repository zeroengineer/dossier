import type * as React from "react"
import { TriangleAlertIcon } from "lucide-react"
import { Link } from "react-router"
import type { DocumentDetail, DocumentEntityRef } from "@/api/types"
import { DateText } from "@/components/date-text"
import { Money } from "@/components/money"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const NONE = <span className="text-muted-foreground">—</span>

/** A link to an entity's page, or a dash. */
export function EntityLink({ entity }: { entity: DocumentEntityRef | null }) {
  if (!entity) return NONE
  return (
    <Link to={`/entities/${entity.id}`} className="underline-offset-4 hover:underline">
      {entity.name}
    </Link>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** Read-only document metadata: number, dates, amount, party, issuer, template and audit dates. */
export function DocumentMetadata({ doc }: { doc: DocumentDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Document details">
          <Row label="Type">{doc.type}</Row>
          <Row label="Number">
            {doc.docNumber ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{doc.docNumber}</span>
                {doc.numberConflict ? (
                  <Badge variant="destructive">
                    <TriangleAlertIcon data-icon="inline-start" />
                    Number conflict
                  </Badge>
                ) : null}
              </span>
            ) : NONE}
          </Row>
          <Row label="Series">{doc.numberSeries ?? NONE}</Row>
          <Row label="Status"><StatusBadge status={doc.status} /></Row>
          <Row label="Sensitivity"><SensitivityBadge level={doc.sensitivity} /></Row>
          <Row label="Amount">
            {doc.amountMinor !== null ? <Money amountMinor={doc.amountMinor} currency={doc.currency ?? undefined} /> : NONE}
          </Row>
          <Row label="Document date"><DateText value={doc.docDate} /></Row>
          <Row label="Due date"><DateText value={doc.dueDate} /></Row>
          <Row label="Party">
            {doc.party ? (
              <span className="flex flex-wrap items-center gap-2">
                <EntityLink entity={doc.party} />
                <Badge variant="secondary">{doc.party.type}</Badge>
              </span>
            ) : NONE}
          </Row>
          <Row label="Issuing entity"><EntityLink entity={doc.issuingEntity} /></Row>
          <Row label="Issuing brand">
            {doc.issuingBrandId ? (
              <Link to={`/settings/brands/${encodeURIComponent(doc.issuingBrandId)}`} className="underline-offset-4 hover:underline">
                {doc.issuingBrandId}
              </Link>
            ) : NONE}
          </Row>
          <Row label="Business line"><EntityLink entity={doc.businessLine} /></Row>
          <Row label="Engagement"><EntityLink entity={doc.engagement} /></Row>
          <Row label="Template">
            {doc.template ? `${doc.template.id}${doc.template.version !== null ? ` v${doc.template.version}` : ""}` : NONE}
          </Row>
          <Row label="Created">
            <span className="flex flex-wrap items-center gap-1">
              <DateText value={doc.createdAt} style="datetime" />
              {doc.createdBy ? <span className="text-muted-foreground">by {doc.createdBy}</span> : null}
            </span>
          </Row>
          <Row label="Last updated"><DateText value={doc.updatedAt} style="datetime" /></Row>
        </dl>
      </CardContent>
    </Card>
  )
}
