import type React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface DiagnosticsItem {
  id?: string
  label: React.ReactNode
  value: React.ReactNode
}

interface SettingsDiagnosticsPanelProps {
  title: React.ReactNode
  items: DiagnosticsItem[]
  actions?: React.ReactNode
  className?: string
}

export const SettingsDiagnosticsPanel = ({
  title,
  items,
  actions,
  className
}: SettingsDiagnosticsPanelProps) => (
  <Card size="sm" className={className}>
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        {actions}
      </div>
    </CardHeader>
    <CardContent>
      <dl className="grid gap-2 text-xs">
        {items.map((item) => (
          <div
            key={item.id ?? String(item.label)}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-1"
            )}>
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 truncate font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </CardContent>
  </Card>
)
