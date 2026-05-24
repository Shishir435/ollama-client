import type React from "react"

import { Card } from "@/components/ui/card"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface ModelCardProps extends React.ComponentProps<typeof Card> {
  icon?: LucideIcon
  name: React.ReactNode
  metadata?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

export const ModelCard = ({
  icon: Icon,
  name,
  metadata,
  description,
  actions,
  className,
  ...props
}: ModelCardProps) => (
  <Card className={cn("p-3", className)} {...props}>
    <div className="flex min-w-0 items-start gap-3">
      {Icon && (
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        {metadata && (
          <div className="mt-1 text-xs text-muted-foreground">{metadata}</div>
        )}
        {description && (
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  </Card>
)
