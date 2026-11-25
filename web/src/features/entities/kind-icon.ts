import {
  BriefcaseIcon, Building2Icon, CalendarRangeIcon, HandshakeIcon, LandmarkIcon, LayersIcon, type LucideIcon, NetworkIcon,
  PackageIcon, TruckIcon, UserIcon,
} from "lucide-react"

const KIND_ICONS: Record<string, LucideIcon> = {
  company: Building2Icon,
  group_entity: NetworkIcon,
  person: UserIcon,
  client: HandshakeIcon,
  vendor: TruckIcon,
  product: PackageIcon,
  business_line: LayersIcon,
  engagement: BriefcaseIcon,
  financial_year: CalendarRangeIcon,
}

/** Icon for an entity kind from `/api/meta`; kinds added later fall back to a generic one. */
export function kindIcon(kind: string): LucideIcon {
  return KIND_ICONS[kind] ?? LandmarkIcon
}
