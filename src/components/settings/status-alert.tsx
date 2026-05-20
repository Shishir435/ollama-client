import type React from "react"
import { Card } from "@/components/ui/card"
import type { LucideIcon } from "@/lib/lucide-icon"
import { STATUS_STYLES } from "@/lib/ui-status"
import { cn } from "@/lib/utils"

interface StatusAlertProps {
  variant?: "default" | "destructive" | "success" | "warning" | "info"
  title: string
  description?: React.ReactNode
  icon?: LucideIcon
  className?: string
  actions?: React.ReactNode
}

export const StatusAlert = ({
  variant = "default",
  title,
  description,
  icon: Icon,
  className,
  actions
}: StatusAlertProps) => {
  const variantStyles = {
    default: "border-primary/20 bg-primary/5 text-primary",
    destructive: cn(
      STATUS_STYLES.danger.borderSoft,
      STATUS_STYLES.danger.bgSoft,
      STATUS_STYLES.danger.text
    ),
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
    )
  }

  return (
    <Card
      className={cn("border ring-0 px-4", variantStyles[variant], className)}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {Icon && <Icon className="size-5 mt-0.5 sm:mt-0 shrink-0" />}
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
}
