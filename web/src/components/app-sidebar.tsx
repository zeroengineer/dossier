import { useEffect } from "react"
import { ChevronRightIcon, SearchIcon } from "lucide-react"
import { Link, useLocation } from "react-router"
import { BrandSwitcher } from "@/components/brand-switcher"
import { useCommandPalette, modKey } from "@/components/command-palette"
import { LogoMark, LogoWordmark } from "@/components/logo"
import { NavUser } from "@/components/nav-user"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  SidebarRail, useSidebar,
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

/** In the icon rail the sub-pages cannot unfold, so Settings opens them as a flyout menu instead. */
function SettingsFlyout({ active, pathname, hash }: { active: boolean; pathname: string; hash: string }) {
  const SettingsIcon = SETTINGS_ICON
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip="Settings" isActive={active}>
          <SettingsIcon />
          <span>Settings</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={4} className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Settings</DropdownMenuLabel>
          {SETTINGS_ITEMS.map((item) => {
            const Icon = item.icon
            const current = isActive(item, pathname, hash)
            return (
              <DropdownMenuItem key={item.to} asChild>
                <Link to={item.to} aria-current={current ? "page" : undefined}>
                  <Icon />
                  {item.title}
                </Link>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SystemGroup({ pathname, hash }: { pathname: string; hash: string }) {
  const SettingsIcon = SETTINGS_ICON
  const { state, isMobile } = useSidebar()
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/")
  const rail = state === "collapsed" && !isMobile
  return (
    <SidebarGroup>
      <SidebarGroupLabel>System</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {rail ? (
            <SidebarMenuItem>
              <SettingsFlyout active={inSettings} pathname={pathname} hash={hash} />
            </SidebarMenuItem>
          ) : (
            <Collapsible asChild defaultOpen className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip="Settings" isActive={inSettings}>
                    <SettingsIcon />
                    <span>Settings</span>
                    <ChevronRightIcon className="ml-auto duration-200 group-data-[state=open]/collapsible:rotate-90 motion-safe:transition-transform" />
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
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar() {
  const { pathname, hash, key } = useLocation()
  const { setOpenMobile } = useSidebar()
  const DocsIcon = DOCS_ICON

  // On phones the sidebar is a Sheet over the page: close it after every navigation, including a tap on the current
  // page's own link (a new location key even when the path is the same).
  useEffect(() => {
    setOpenMobile(false)
  }, [key, setOpenMobile])

  return (
    <Sidebar
      variant="floating"
      collapsible="icon"
      role="complementary"
      aria-label="Sidebar"
      className="*:data-[slot=sidebar-inner]:rounded-xl *:data-[slot=sidebar-inner]:shadow-lg"
    >
      <SidebarHeader className="gap-3">
        <Link to="/" className="flex items-center gap-1.5 px-1 pt-1 text-sidebar-foreground group-data-[collapsible=icon]:px-0" aria-label="Dossier home">
          <LogoMark />
          <LogoWordmark className="group-data-[collapsible=icon]:hidden" />
        </Link>
        <BrandSwitcher />
        <SearchButton />
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Main" className="flex flex-col">
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
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-3">
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
