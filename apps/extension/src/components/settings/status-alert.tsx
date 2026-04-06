import type React from "react"
import type { LucideIcon } from "@/lib/lucide-icon"
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
    destructive:
      "border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400",
    success:
      "border-green-500/20 bg-green-500/5 text-green-600 dark:text-green-400",
    warning:
      "border-yellow-500/20 bg-yellow-500/5 text-yellow-600 dark:text-yellow-400",
    info: "border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400"
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        variantStyles[variant],
        className
      )}>
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
    </div>
  )
}
