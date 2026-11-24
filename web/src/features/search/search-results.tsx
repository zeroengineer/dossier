import type * as React from "react"
import { Link } from "react-router"
import { Building2Icon, FileTextIcon, LinkIcon } from "lucide-react"
import type { DocumentSummary, SearchEntity, SearchHit, SearchMatch, SearchRelated, SearchResult } from "@/api/types"
import { DateText } from "@/components/date-text"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Highlighted } from "./highlight"
import { documentPath, entityPath } from "./paths"

const MATCH_LABEL: Record<SearchMatch, string> = { number: "Number", metadata: "Metadata", text: "Text" }

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id={id} className="font-heading text-base font-semibold">{title}</h2>
        <Badge variant="secondary" className="tabular-nums">{count}</Badge>
      </div>
      {children}
    </section>
  )
}

/** One document row: number and title (a link), type, party, date, status, plus optional extra lines and badges. */
function DocumentItem({ document: d, extra, badge }: { document: DocumentSummary; extra?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <Item variant="outline" size="sm" asChild>
      <Link to={documentPath(d.id)}>
        <ItemMedia variant="icon">
          <FileTextIcon />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="min-w-0">
            {d.docNumber ? <span className="font-mono text-muted-foreground tabular-nums">{d.docNumber}</span> : null}
            <span className="truncate">{d.title}</span>
          </ItemTitle>
          <ItemDescription className="flex flex-wrap items-center gap-x-2">
            <span>{d.type}</span>
            {d.party ? <span>· {d.party.name}</span> : null}
            {d.docDate ? (
              <span>
                · <DateText value={d.docDate} />
              </span>
            ) : null}
          </ItemDescription>
          {extra}
        </ItemContent>
        <ItemActions className="flex-wrap">
          {badge}
          <StatusBadge status={d.status} />
        </ItemActions>
      </Link>
    </Item>
  )
}

function HitItem({ hit }: { hit: SearchHit }) {
  return (
    <DocumentItem
      document={hit.document}
      badge={<Badge variant="outline">{MATCH_LABEL[hit.match]}</Badge>}
      extra={
        hit.snippet ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            <Highlighted snippet={hit.snippet} />
          </p>
        ) : null
      }
    />
  )
}

/** How a related document was reached: `<relation> of <entity>` or `<relation> · <document id>`. */
export function viaText(via: SearchRelated["via"], entities: SearchEntity[]): string {
  if (via.kind === "entity") {
    const entity = entities.find((e) => e.id === via.from)
    return `${via.relation} of ${entity ? entity.name : `entity ${via.from}`}`
  }
  return `${via.relation} · ${via.from}`
}

function RelatedItem({ related, entities }: { related: SearchRelated; entities: SearchEntity[] }) {
  return (
    <DocumentItem
      document={related.document}
      extra={
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LinkIcon className="size-3" aria-hidden />
          <span>Via {viaText(related.via, entities)}</span>
        </p>
      }
    />
  )
}

function EntityItem({ entity }: { entity: SearchEntity }) {
  const others = entity.aliases.filter((a) => a !== entity.matched)
  return (
    <Item variant="outline" size="sm" asChild>
      <Link to={entityPath(entity.id)}>
        <ItemMedia variant="icon">
          <Building2Icon />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="min-w-0">
            <span className="truncate">{entity.name}</span>
          </ItemTitle>
          <ItemDescription>
            {entity.matched ? <>Matched alias “{entity.matched}”</> : others.length ? <>Also {others.join(", ")}</> : entity.kind}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline">{entity.kind}</Badge>
        </ItemActions>
      </Link>
    </Item>
  )
}

/** The Matched, Related and Entities sections of a search result; empty sections are left out. */
export function SearchResults({ result }: { result: SearchResult }) {
  return (
    <div className="flex flex-col gap-8">
      {result.hits.length ? (
        <Section id="search-matched" title="Matched" count={result.hits.length}>
          <ItemGroup className="gap-2">
            {result.hits.map((hit) => (
              <HitItem key={hit.document.id} hit={hit} />
            ))}
          </ItemGroup>
        </Section>
      ) : null}
      {result.related.length ? (
        <Section id="search-related" title="Related" count={result.related.length}>
          <ItemGroup className="gap-2">
            {result.related.map((r) => (
              <RelatedItem key={r.document.id} related={r} entities={result.entities} />
            ))}
          </ItemGroup>
        </Section>
      ) : null}
      {result.entities.length ? (
        <Section id="search-entities" title="Entities" count={result.entities.length}>
          <ItemGroup className="gap-2">
            {result.entities.map((e) => (
              <EntityItem key={e.id} entity={e} />
            ))}
          </ItemGroup>
        </Section>
      ) : null}
    </div>
  )
}

export function SearchResultsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading results">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}
