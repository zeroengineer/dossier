import { BookTextIcon, ChevronsUpDownIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { Link } from "react-router"
import { useMe } from "@/api/me"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, useSidebar } from "@/components/ui/sidebar"
import { DOCS_URL } from "@/lib/links"

/** The configured user (no login yet): id and clearance, with shortcuts to workspace settings. */
export function NavUser() {
  const { data: me, isPending, isError } = useMe()
  const { isMobile } = useSidebar()

  if (isPending) return <SidebarMenuSkeleton showIcon />
  if (isError || !me) return null

  const { id, clearance } = me.user
  const fallback = id.slice(0, 2).toUpperCase()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={id} data-testid="nav-user">
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="rounded-md">{fallback}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{id}</span>
                <span className="flex items-center gap-1">
                  <span className="sr-only">Clearance</span>
                  <SensitivityBadge level={clearance} />
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                <span className="truncate font-medium">{id}</span>
                <span className="text-xs text-muted-foreground">{clearance} clearance</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/settings/workspace">
                  <SettingsIcon />
                  Workspace settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/workspace#users">
                  <UsersIcon />
                  Users and clearance
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={DOCS_URL} target="_blank" rel="noreferrer">
                  <BookTextIcon />
                  Documentation
                </a>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Dossier {me.version}</DropdownMenuLabel>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
