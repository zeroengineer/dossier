import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { Link } from "react-router"
import { useMe } from "@/api/me"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, useSidebar } from "@/components/ui/sidebar"
import { useActiveBrand } from "@/lib/active-brand"
import { SETTINGS_ICON } from "@/lib/nav"

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?"
}

/** Picks the brand the user works under; the choice is kept in localStorage and feeds Generate's default brand. */
export function BrandSwitcher() {
  const { data: me, isPending } = useMe()
  const { brand, brands, select } = useActiveBrand(me)
  const { isMobile } = useSidebar()
  const SettingsIcon = SETTINGS_ICON

  if (isPending) return <SidebarMenuSkeleton showIcon />

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" variant="outline" tooltip={brand?.shortName ?? "Brand"}>
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="rounded-md text-xs font-semibold">{brand ? initials(brand.shortName) : "?"}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{brand?.shortName ?? "No brand"}</span>
                <span className="truncate text-xs text-muted-foreground">{me?.workspace.name ?? "Workspace"}</span>
              </span>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" align="start" side={isMobile ? "bottom" : "right"} sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Brands</DropdownMenuLabel>
              {brands.map((b) => (
                <DropdownMenuItem key={b.id} onSelect={() => select(b.id)}>
                  <Avatar className="size-6 rounded-sm">
                    <AvatarFallback className="rounded-sm text-xs">{initials(b.shortName)}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate">{b.shortName}</span>
                  {b.id === brand?.id ? <CheckIcon /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/settings/brands">
                  <SettingsIcon />
                  Manage brands
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
