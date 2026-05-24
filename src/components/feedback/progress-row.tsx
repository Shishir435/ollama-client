import type React from "react"

import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface ProgressRowProps {
  label: React.ReactNode
  value: number
  valueLabel?: React.ReactNode
  className?: string
}

export const ProgressRow = ({
  label,
  value,
  valueLabel,
  className
}: ProgressRowProps) => (
  <div className={cn("space-y-2", className)}>
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{label}</span>
      <span>{valueLabel ?? `${Math.round(value)}%`}</span>
    </div>
    <Progress value={value} />
  </div>
)
