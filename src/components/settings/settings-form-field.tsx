import type React from "react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface SettingsFormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  description?: React.ReactNode
  error?: string
  children?: React.ReactNode
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
  htmlFor,
  ...props
}: SettingsFormFieldProps) => {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <Label
        htmlFor={htmlFor}
        className={cn("flex items-center gap-2 text-sm", labelClassName)}>
        {label}
      </Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
