import type React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface SettingsRowProps extends React.ComponentProps<"div"> {
  label: React.ReactNode
  description?: React.ReactNode
  htmlFor?: string
  control?: React.ReactNode
}

export const SettingsRow = ({
  label,
  description,
  htmlFor,
  control,
  className,
  children,
  ...props
}: SettingsRowProps) => (
  <div
    className={cn(
      "flex flex-col gap-3 rounded-control border border-border/70 bg-card/50 p-3 sm:flex-row sm:items-center sm:justify-between",
      className
    )}
    {...props}>
    <div className="min-w-0 space-y-1">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
    {control ?? children}
  </div>
)
