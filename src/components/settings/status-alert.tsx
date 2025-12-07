import type React from "react"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface StatusAlertProps {
  variant?: "default" | "destructive" | "success" | "warning"
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
      "border-yellow-500/20 bg-yellow-500/5 text-yellow-600 dark:text-yellow-400"
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        variantStyles[variant],
        className
      )}>
      <div className="flex items-start gap-3">
        {Icon && <Icon className="h-5 w-5 mt-0.5 shrink-0" />}
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium">{title}</p>
          {description && (
            <div className="text-xs text-muted-foreground opacity-90">
              {description}
            </div>
          )}
          {actions && <div className="pt-1">{actions}</div>}
        </div>
      </div>
    </div>
  )
}
