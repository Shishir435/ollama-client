import type React from "react"

import { SettingsCard } from "@/components/settings/settings-card"
import type { LucideIcon } from "@/lib/lucide-icon"
import { TriangleAlert } from "@/lib/lucide-icon"

interface SettingsDangerZoneProps {
  title: string
  description: string
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}

export const SettingsDangerZone = ({
  title,
  description,
  icon = TriangleAlert,
  children,
  className
}: SettingsDangerZoneProps) => (
  <SettingsCard
    icon={icon}
    title={title}
    description={description}
    className={className}
    contentClassName="space-y-4">
    {children}
  </SettingsCard>
)
