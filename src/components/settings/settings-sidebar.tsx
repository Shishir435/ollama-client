import { MiniBadge } from "@/components/ui/mini-badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  badge?: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

interface SettingsSidebarProps {
  sections: NavSection[]
  activeTab: string
  onTabChange: (key: string) => void
  className?: string
}

export const SettingsSidebar = ({
  sections,
  activeTab,
  onTabChange,
  className
}: SettingsSidebarProps) => {
  return (
    <aside
      className={cn(
        "hidden w-56 shrink-0 bg-sidebar text-sidebar-foreground lg:block",
        className
      )}>
      <nav aria-label="Settings navigation" className="h-full">
        <ScrollArea className="h-full">
          <div className="space-y-5 pr-2">
            {sections.map((section, idx) => (
              <div key={section.title}>
                {idx > 0 && <Separator className="mb-4" />}
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {section.title}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => onTabChange(item.key)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}>
                        <span
                          className={cn(
                            "absolute left-0.5 top-1/2 -translate-y-1/2 h-5 w-0.75 rounded-full transition-all duration-200",
                            isActive
                              ? "bg-sidebar-primary opacity-100"
                              : "bg-transparent opacity-0 group-hover:bg-sidebar-primary group-hover:opacity-40"
                          )}
                        />
                        <Icon
                          className={cn(
                            "size-4 shrink-0 transition-colors duration-150",
                            isActive
                              ? "text-sidebar-primary"
                              : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground"
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                        {item.badge && (
                          <MiniBadge text={item.badge} className="ml-auto" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </nav>
    </aside>
  )
}
