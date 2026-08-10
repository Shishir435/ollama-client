import type React from "react"
import { Switch } from "@/components/ui/switch"
import { SettingsControlCard } from "./settings-control-card"

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
}: SettingsSwitchProps) => (
  <SettingsControlCard
    id={id}
    label={label}
    description={description}
    className={className}
    control={
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    }
  />
)
