import type React from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { MiniBadge } from "@/components/ui/mini-badge"
import type { LucideIcon } from "@/lib/lucide-icon"

export interface SettingsCardProps {
  icon?: LucideIcon
  title: string
  description: string
  badge?: string
  children: React.ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  headerActions?: React.ReactNode
}

/**
 * A standardized settings card component with consistent icon, title, description,
 * and optional badge styling.
 *
 * This component eliminates the repeated Card+CardHeader+CardTitle pattern across
 * settings components and ensures consistent spacing and styling.
 *
 * @example
 * ```tsx
 * <SettingsCard
 *   icon={Globe}
 *   title={t("settings.language.title")}
 *   description={t("settings.language.description")}
 *   badge="Beta"
 * >
 *   <LanguageSelector />
 * </SettingsCard>
 * ```
 */
export const SettingsCard = ({
  icon: Icon,
  title,
  description,
  badge,
  children,
  className,
  headerClassName,
  contentClassName,
  headerActions
}: SettingsCardProps) => {
  return (
    <Card className={className}>
      <CardHeader className={headerClassName || "pb-4"}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
            <CardTitle className="text-lg">{title}</CardTitle>
            {badge && <MiniBadge text={badge} />}
          </div>
          {headerActions && (
            <div className="flex items-center gap-3">{headerActions}</div>
          )}
        </div>
        <CardDescription className="text-sm">{description}</CardDescription>
      </CardHeader>
      <CardContent className={contentClassName || "space-y-4"}>
        {children}
      </CardContent>
    </Card>
  )
}
