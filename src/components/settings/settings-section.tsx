import type React from "react"

import { SectionHeader } from "@/components/settings/section-header"
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
  icon,
  badge,
  className,
  children,
  ...props
}: SettingsSectionProps) => (
  <section className={cn("space-y-4", className)} {...props}>
    {title && (
      <SectionHeader
        title={title}
        description={description}
        icon={icon}
        badge={badge}
      />
    )}
    {children}
  </section>
)
