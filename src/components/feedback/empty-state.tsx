import type React from "react"

import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  actions,
  className,
  ...props
}: EmptyStateProps) => (
  <div
    className={cn(
      "flex min-h-48 flex-col items-center justify-center px-4 text-center",
      className
    )}
    {...props}>
    {Icon && (
      <div className="mb-4 rounded-full bg-muted/30 p-4">
        <Icon className="icon-3xl text-muted-foreground/40" />
      </div>
    )}
    <h3 className="mb-1 text-sm font-medium text-foreground">{title}</h3>
    {description && (
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
    )}
    {actions && <div className="mt-4">{actions}</div>}
  </div>
)
