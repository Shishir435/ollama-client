import type React from "react"

import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface MetadataChipProps extends React.ComponentProps<"span"> {
  icon?: LucideIcon
  label?: React.ReactNode
  value: React.ReactNode
}

export const MetadataChip = ({
  icon: Icon,
  label,
  value,
  className,
  ...props
}: MetadataChipProps) => (
  <span
    className={cn(
      "inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground",
      className
    )}
    {...props}>
    {Icon && <Icon className="icon-xs shrink-0" />}
    {label && <span className="shrink-0">{label}</span>}
    <span className="truncate font-medium text-foreground">{value}</span>
  </span>
)
