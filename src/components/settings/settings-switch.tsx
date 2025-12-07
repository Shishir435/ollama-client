import type React from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface SettingsSwitchProps {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  className?: string
}

export const SettingsSwitch = ({
  label,
  description,
  checked,
  onCheckedChange,
  id,
  className
}: SettingsSwitchProps) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border p-4",
        className
      )}>
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-base font-medium">
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
