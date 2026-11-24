import {
  BookTextIcon, Building2Icon, FilePlus2Icon, FilesIcon, FolderTreeIcon, HashIcon, LayoutDashboardIcon,
  LayoutTemplateIcon, PaletteIcon, SearchIcon, SettingsIcon, UploadIcon, UsersIcon, type LucideIcon,
} from "lucide-react"

export interface NavItem {
  title: string
  to: string
  icon: LucideIcon
  /** Extra words the command palette matches on. */
  keywords?: string[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Sidebar navigation (and the command palette's Navigate group). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", to: "/", icon: LayoutDashboardIcon, keywords: ["home", "overview"] },
      { title: "Vault", to: "/vault", icon: FolderTreeIcon, keywords: ["folders", "tree"] },
      { title: "Documents", to: "/documents", icon: FilesIcon, keywords: ["list", "table"] },
      { title: "Entities", to: "/entities", icon: Building2Icon, keywords: ["clients", "vendors", "people", "companies"] },
    ],
  },
  {
    label: "Create",
    items: [
      { title: "Generate", to: "/generate", icon: FilePlus2Icon, keywords: ["new", "invoice", "letter"] },
      { title: "Templates", to: "/templates", icon: LayoutTemplateIcon },
      { title: "Upload", to: "/upload", icon: UploadIcon, keywords: ["import", "file"] },
    ],
  },
]

/** The System group's Settings sub-pages. */
export const SETTINGS_ITEMS: NavItem[] = [
  { title: "Brands", to: "/settings/brands", icon: PaletteIcon, keywords: ["letterhead", "logo"] },
  { title: "Numbering", to: "/settings/numbering", icon: HashIcon, keywords: ["series", "counters"] },
  { title: "Workspace", to: "/settings/workspace", icon: SettingsIcon, keywords: ["locale", "hierarchy"] },
  { title: "Users", to: "/settings/workspace#users", icon: UsersIcon, keywords: ["clearance"] },
]

export const SEARCH_ITEM: NavItem = { title: "Search", to: "/search", icon: SearchIcon, keywords: ["find"] }
export const DOCS_ICON = BookTextIcon
export const SETTINGS_ICON = SettingsIcon

/**
 * Whether `item` is the current page. `/` matches only itself; other paths match themselves and their children;
 * items with a hash match only that hash, and a path item does not match while a sibling's hash is active.
 */
export function isActive(item: Pick<NavItem, "to">, pathname: string, hash: string): boolean {
  const [path = "", itemHash] = item.to.split("#")
  if (itemHash !== undefined) return pathname === path && hash === `#${itemHash}`
  if (path === "/") return pathname === "/"
  const matches = pathname === path || pathname.startsWith(`${path}/`)
  if (!matches) return false
  const hashSibling = SETTINGS_ITEMS.some((s) => s.to.startsWith(`${path}#`) && hash === `#${s.to.split("#")[1]}`)
  return !hashSibling
}
