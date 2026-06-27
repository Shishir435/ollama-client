import type React from "react"

import { cn } from "@/lib/utils"

interface DiagnosticsListItem {
  id?: string
  label: React.ReactNode
  value: React.ReactNode
}

interface DiagnosticsListProps {
  items: DiagnosticsListItem[]
  className?: string
}

export const DiagnosticsList = ({ items, className }: DiagnosticsListProps) => (
  <dl className={cn("grid gap-2 text-xs", className)}>
    {items.map((item) => (
      <div
        key={item.id ?? String(item.label)}
        className="flex items-center justify-between gap-3 rounded-control bg-muted/30 px-2 py-1">
        <dt className="text-muted-foreground">{item.label}</dt>
        <dd className="min-w-0 truncate font-medium">{item.value}</dd>
      </div>
    ))}
  </dl>
)
