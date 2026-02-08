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
    <aside className={cn("hidden lg:block w-56 shrink-0", className)}>
      <nav className="sticky top-8" aria-label="Settings navigation">
        <ScrollArea className="h-[calc(100vh-12rem)]">
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
                          "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                        )}>
                        <span
                          className={cn(
                            "absolute left-0.5 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full transition-all duration-200",
                            isActive
                              ? "bg-primary opacity-100"
                              : "bg-transparent opacity-0 group-hover:opacity-40 group-hover:bg-primary"
                          )}
                        />
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0 transition-colors duration-150",
                            isActive
                              ? "text-foreground"
                              : "text-muted-foreground/70 group-hover:text-foreground/80"
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
