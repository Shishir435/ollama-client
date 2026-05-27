import type React from "react"

import { HealthBadge } from "@/components/feedback"
import { Card } from "@/components/ui/card"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

type ProviderState = "healthy" | "warning" | "error" | "offline"

interface ProviderCardProps extends React.ComponentProps<typeof Card> {
  icon?: LucideIcon
  name: React.ReactNode
  description?: React.ReactNode
  state?: ProviderState
  actions?: React.ReactNode
}

const stateVariant: Record<
  ProviderState,
  React.ComponentProps<typeof HealthBadge>["tone"]
> = {
  healthy: "success",
  warning: "warning",
  error: "danger",
  offline: "neutral"
}

export const ProviderCard = ({
  icon: Icon,
  name,
  description,
  state = "offline",
  actions,
  className,
  ...props
}: ProviderCardProps) => (
  <Card className={cn("p-4", className)} {...props}>
    <div className="flex min-w-0 items-start gap-3">
      {Icon && (
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-semibold">{name}</div>
          <HealthBadge label={state} tone={stateVariant[state]} />
        </div>
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
