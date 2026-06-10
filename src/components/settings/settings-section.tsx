import type React from "react"

import { MiniBadge } from "@/components/ui/mini-badge"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface SettingsSectionProps
  extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  badge?: React.ReactNode
}

export const SettingsSection = ({
  title,
  description,
  icon: Icon,
  badge,
  className,
  children,
  ...props
}: SettingsSectionProps) => (
  <section className={cn("space-y-4", className)} {...props}>
    {title && (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="icon-md text-muted-foreground" />}
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge && <MiniBadge text={badge} />}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    )}
    {children}
  </section>
)
