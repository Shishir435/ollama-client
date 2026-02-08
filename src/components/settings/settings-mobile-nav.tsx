import { MiniBadge } from "@/components/ui/mini-badge"
import { cn } from "@/lib/utils"
import type { NavItem } from "./settings-sidebar"

interface SettingsMobileNavProps {
  items: NavItem[]
  activeTab: string
  onTabChange: (key: string) => void
  className?: string
}

export const SettingsMobileNav = ({
  items,
  activeTab,
  onTabChange,
  className
}: SettingsMobileNavProps) => {
  return (
    <nav
      className={cn("mb-6 lg:hidden", className)}
      aria-label="Settings navigation">
      <div className="flex gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-1 scrollbar-none">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onTabChange(item.key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}>
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
              {item.badge && <MiniBadge text={item.badge} />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
