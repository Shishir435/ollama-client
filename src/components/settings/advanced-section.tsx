import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { MiniBadge } from "@/components/ui/mini-badge"
import { cn } from "@/lib/class-names"

interface AdvancedSectionProps {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  badge?: React.ReactNode
  /**
   * One-line summary of the current values, shown only while collapsed so a
   * user can see what's inside without expanding (item 10).
   */
  summary?: React.ReactNode
  /** Start expanded. Defaults to collapsed. Ignored when `destructive`. */
  defaultOpen?: boolean
  /** Expand when a settings-search deep link targets content inside. */
  forceOpen?: boolean
  /**
   * Marks the block as containing delete/clear actions. Destructive content is
   * never auto-collapsed: the section renders expanded with no collapse toggle,
   * so dangerous controls are never hidden behind a chevron.
   */
  destructive?: boolean
  className?: string
  children?: React.ReactNode
}

export const AdvancedSection = ({
  title,
  description,
  icon: Icon,
  badge,
  summary,
  defaultOpen = false,
  forceOpen = false,
  destructive = false,
  className,
  children
}: AdvancedSectionProps) => {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  // Destructive blocks are always expanded and have no toggle.
  const expanded = destructive || (openOverride ?? (defaultOpen || forceOpen))
  const Chevron = expanded ? ChevronDown : ChevronRight

  const headerInner = (
    <div className="flex items-center gap-2">
      {!destructive && (
        <Chevron className="icon-sm text-muted-foreground" aria-hidden />
      )}
      {Icon && <Icon className="icon-md text-muted-foreground" />}
      <h3 className="text-sm font-semibold">{title}</h3>
      {badge && <MiniBadge text={badge} />}
    </div>
  )

  return (
    <section className={cn("space-y-4", className)}>
      <div className="space-y-1">
        {destructive ? (
          headerInner
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setOpenOverride(!expanded)}
            className="flex w-full items-center rounded-control text-left outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-focus">
            {headerInner}
          </button>
        )}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {expanded
        ? children
        : summary && <p className="text-xs text-muted-foreground">{summary}</p>}
    </section>
  )
}
