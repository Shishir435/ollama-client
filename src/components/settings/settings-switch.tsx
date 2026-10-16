import type React from "react"
import { Switch } from "@/components/ui/switch"
import { SettingsRow } from "./settings-row"

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
  <SettingsRow
    focusId={id}
    htmlFor={id}
    label={label}
    description={description}
    className={className}
    control={
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    }
  />
)
