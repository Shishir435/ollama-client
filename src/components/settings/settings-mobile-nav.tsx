import type React from "react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { MiniBadge } from "@/components/ui/mini-badge"
import { cn } from "@/lib/class-names"
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
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)

  /** Keep the selected tab visible in a strip that scrolls sideways. */
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "center" })
  }, [activeTab])

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"]
    if (!keys.includes(event.key)) return
    const index = items.findIndex((item) => item.key === activeTab)
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) %
            items.length
    const target = items[next]
    if (!target) return
    event.preventDefault()
    onTabChange(target.key)
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>(`[data-tab-key="${target.key}"]`)
        ?.focus()
    )
  }

  return (
    <nav
      className={cn("md:hidden", className)}
      aria-label={t("settings.nav_label")}>
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs inside carry the roving tabindex; the list itself is not a focus stop */}
      <div
        ref={listRef}
        role="tablist"
        aria-label={t("settings.nav_label")}
        onKeyDown={moveFocus}
        className="scroll-fade-x flex gap-0.5 overflow-x-auto rounded-panel bg-surface-sunken p-1 scrollbar-none">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`settings-tab-${item.key}`}
              data-tab-key={item.key}
              aria-selected={isActive}
              aria-controls="settings-tabpanel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(item.key)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
                isActive
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-state-hover"
              )}>
              <Icon className="icon-sm shrink-0" />
              {item.label}
              {item.badge && <MiniBadge text={item.badge} />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
