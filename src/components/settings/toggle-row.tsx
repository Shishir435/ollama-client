import type React from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface ToggleRowProps {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  className?: string
}

export const ToggleRow = ({
  label,
  description,
  checked,
  onCheckedChange,
  id,
  className
}: ToggleRowProps) => {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
