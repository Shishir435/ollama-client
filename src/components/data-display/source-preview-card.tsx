import type React from "react"

import { Card } from "@/components/ui/card"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface SourcePreviewCardProps
  extends Omit<React.ComponentProps<typeof Card>, "title"> {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
}

export const SourcePreviewCard = ({
  icon: Icon,
  title,
  description,
  meta,
  actions,
  className,
  ...props
}: SourcePreviewCardProps) => (
  <Card className={cn("p-3", className)} {...props}>
    <div className="flex min-w-0 items-start gap-3">
      {Icon && (
        <Icon className="mt-0.5 icon-md shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {description && (
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {description}
          </div>
        )}
        {meta && (
          <div className="mt-2 text-xs text-muted-foreground">{meta}</div>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  </Card>
)
