import type React from "react"

import { Card, CardContent } from "@/components/ui/card"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface MetricTileProps {
  label: React.ReactNode
  value: React.ReactNode
  icon?: LucideIcon
  description?: React.ReactNode
  className?: string
}

export const MetricTile = ({
  label,
  value,
  icon: Icon,
  description,
  className
}: MetricTileProps) => (
  <Card size="sm" className={className}>
    <CardContent className="flex items-start gap-3">
      {Icon && (
        <div className="rounded-md bg-muted/40 p-2 text-muted-foreground">
          <Icon className="icon-md" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("truncate text-sm font-semibold")}>{value}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </CardContent>
  </Card>
)
