import type React from "react"

import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface CommandListItemProps
  extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
}

export const CommandListItem = ({
  icon: Icon,
  title,
  description,
  meta,
  actions,
  className,
  ...props
}: CommandListItemProps) => (
  <div
    className={cn(
      "flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left",
      className
    )}
    {...props}>
    {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-medium">{title}</div>
      {description && (
        <div className="truncate text-xs text-muted-foreground">
          {description}
        </div>
      )}
    </div>
    {meta && (
      <div className="shrink-0 text-xs text-muted-foreground">{meta}</div>
    )}
    {actions && <div className="shrink-0">{actions}</div>}
  </div>
)
