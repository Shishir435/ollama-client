import type React from "react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface SettingsFormFieldProps {
  label: React.ReactNode
  description?: React.ReactNode
  error?: string
  children: React.ReactNode
  className?: string
  labelClassName?: string
  htmlFor?: string
}

export const SettingsFormField = ({
  label,
  description,
  error,
  children,
  className,
  labelClassName,
  htmlFor
}: SettingsFormFieldProps) => {
  return (
    <div className={cn("space-y-2", className)}>
      <Label
        htmlFor={htmlFor}
        className={cn("flex items-center gap-2 text-sm", labelClassName)}>
        {label}
      </Label>
      {children}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
