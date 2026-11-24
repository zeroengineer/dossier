import { Link, useLocation } from "react-router"
import { Button } from "@/components/ui/button"
import { isActive, SETTINGS_ITEMS } from "@/lib/nav"
import { cn } from "@/lib/utils"

/** Links between the settings pages (Brands, Numbering, Workspace, Users), the current one highlighted. */
export function SettingsNav({ className }: { className?: string }) {
  const { pathname, hash } = useLocation()
  return (
    <nav aria-label="Settings" className={cn("flex flex-wrap gap-1 border-b pb-2", className)}>
      {SETTINGS_ITEMS.map((item) => {
        const active = isActive(item, pathname, hash)
        return (
          <Button key={item.to} asChild variant={active ? "secondary" : "ghost"} size="sm">
            <Link to={item.to} aria-current={active ? "page" : undefined}>
              <item.icon data-icon="inline-start" />
              {item.title}
            </Link>
          </Button>
        )
      })}
    </nav>
  )
}
