import type React from "react"

import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"

import { SettingsField } from "./settings-field"

interface SettingsSliderFieldProps {
  label: React.ReactNode
  description?: React.ReactNode
  value: number
  min: number
  max: number
  step?: number
  onValueChange: (value: number) => void
  leftLabel?: React.ReactNode
  rightLabel?: React.ReactNode
  valueLabel?: React.ReactNode
}

export const SettingsSliderField = ({
  label,
  description,
  value,
  min,
  max,
  step,
  onValueChange,
  leftLabel,
  rightLabel,
  valueLabel
}: SettingsSliderFieldProps) => (
  <SettingsField
    label={
      <span className="inline-flex items-center gap-2">
        <span>{label}</span>
        <SettingsValueBadge>{valueLabel ?? value}</SettingsValueBadge>
      </span>
    }
    description={description}
    className="space-y-3">
    <Slider
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) =>
        onValueChange(Array.isArray(next) ? next[0] : next)
      }
    />
    {(leftLabel || rightLabel) && (
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    )}
  </SettingsField>
)

export const SettingsValueBadge = ({
  className,
  ...props
}: React.ComponentProps<typeof Badge>) => (
  <Badge variant="outline" className={className ?? "font-mono"} {...props} />
)
