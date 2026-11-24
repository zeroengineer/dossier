import { ChevronRightIcon, SearchIcon } from "lucide-react"
import { Link, useLocation } from "react-router"
import { BrandSwitcher } from "@/components/brand-switcher"
import { useCommandPalette, modKey } from "@/components/command-palette"
import { LogoMark, LogoWordmark } from "@/components/logo"
import { NavUser } from "@/components/nav-user"
import { WhatsNewCard } from "@/components/whats-new"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { DOCS_URL } from "@/lib/links"
import { DOCS_ICON, NAV_GROUPS, SETTINGS_ICON, SETTINGS_ITEMS, isActive } from "@/lib/nav"

function SearchButton() {
  const { setOpen } = useCommandPalette()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton variant="outline" tooltip={`Search (${modKey()} K)`} onClick={() => setOpen(true)} className="text-muted-foreground">
          <SearchIcon />
          <span>Search</span>
          <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">{modKey()} K</Kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function SystemGroup({ pathname, hash }: { pathname: string; hash: string }) {
  const SettingsIcon = SETTINGS_ICON
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/")
  return (
    <SidebarGroup>
      <SidebarGroupLabel>System</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <Collapsible asChild defaultOpen className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip="Settings" isActive={inSettings}>
                  <SettingsIcon />
                  <span>Settings</span>
                  <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {SETTINGS_ITEMS.map((item) => (
                    <SidebarMenuSubItem key={item.to}>
                      <SidebarMenuSubButton asChild isActive={isActive(item, pathname, hash)}>
                        <Link to={item.to} aria-current={isActive(item, pathname, hash) ? "page" : undefined}>
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar() {
  const { pathname, hash } = useLocation()
  const DocsIcon = DOCS_ICON

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3">
        <Link to="/" className="flex items-center gap-2 px-1 pt-1 group-data-[collapsible=icon]:px-0" aria-label="Dossier home">
          <LogoMark />
          <LogoWordmark className="group-data-[collapsible=icon]:hidden" />
        </Link>
        <BrandSwitcher />
        <SearchButton />
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item, pathname, hash)
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.to} aria-current={active ? "page" : undefined}>
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SystemGroup pathname={pathname} hash={hash} />
      </SidebarContent>

      <SidebarFooter className="gap-3">
        <WhatsNewCard />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Help and docs">
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                <DocsIcon />
                <span>Help and docs</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
