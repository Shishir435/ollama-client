import type React from "react"

import { Card } from "@/components/ui/card"
import type { LucideIcon } from "@/lib/lucide-icon"
import { STATUS_STYLES } from "@/lib/ui-status"
import { cn } from "@/lib/utils"

export type StatusCalloutVariant =
  | "default"
  | "success"
  | "warning"
  | "info"
  | "danger"

interface StatusCalloutProps {
  variant?: StatusCalloutVariant
  title: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
  className?: string
}

const variantStyles: Record<StatusCalloutVariant, string> = {
  default: "border-primary/20 bg-primary/5 text-primary",
  success: cn(
    STATUS_STYLES.success.borderSoft,
    STATUS_STYLES.success.bgSoft,
    STATUS_STYLES.success.text
  ),
  warning: cn(
    STATUS_STYLES.warning.borderSoft,
    STATUS_STYLES.warning.bgSoft,
    STATUS_STYLES.warning.text
  ),
  info: cn(
    STATUS_STYLES.info.borderSoft,
    STATUS_STYLES.info.bgSoft,
    STATUS_STYLES.info.text
  ),
  danger: cn(
    STATUS_STYLES.danger.borderSoft,
    STATUS_STYLES.danger.bgSoft,
    STATUS_STYLES.danger.text
  )
}

export const StatusCallout = ({
  variant = "default",
  title,
  description,
  icon: Icon,
  actions,
  className
}: StatusCalloutProps) => (
  <Card
    className={cn(
      "border px-4 py-3 ring-0",
      variantStyles[variant],
      className
    )}>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex items-start gap-3">
        {Icon && <Icon className="mt-0.5 size-5 shrink-0" />}
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          {description && (
            <div className="text-xs text-muted-foreground opacity-90">
              {description}
            </div>
          )}
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  </Card>
)
