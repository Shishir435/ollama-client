import type React from "react"

import { cn } from "@/lib/utils"

export interface InfoListItem {
  id?: string
  label: React.ReactNode
  value: React.ReactNode
  description?: React.ReactNode
}

interface InfoListProps extends React.ComponentProps<"dl"> {
  items: InfoListItem[]
}

export const InfoList = ({ items, className, ...props }: InfoListProps) => (
  <dl
    className={cn("divide-y divide-border rounded-control border", className)}
    {...props}>
    {items.map((item) => (
      <div
        key={item.id ?? `${String(item.label)}-${String(item.value)}`}
        className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)] sm:gap-3">
        <dt className="text-xs text-muted-foreground">{item.label}</dt>
        <dd className="min-w-0 text-xs text-foreground">
          <div className="truncate font-medium">{item.value}</div>
          {item.description && (
            <div className="mt-0.5 text-muted-foreground">
              {item.description}
            </div>
          )}
        </dd>
      </div>
    ))}
  </dl>
)
