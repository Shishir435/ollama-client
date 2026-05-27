import type React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface SettingsInlineControlProps extends React.ComponentProps<"div"> {
  label?: React.ReactNode
  htmlFor?: string
  description?: React.ReactNode
}

export const SettingsInlineControl = ({
  label,
  htmlFor,
  description,
  className,
  children,
  ...props
}: SettingsInlineControlProps) => (
  <div className={cn("flex items-center gap-2", className)} {...props}>
    {label && (
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    )}
    {children}
  </div>
)
