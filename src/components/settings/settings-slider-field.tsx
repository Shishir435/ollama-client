import type React from "react"

import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

import { SettingsFormField } from "./settings-form-field"

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
  /** Settings-registry focus id; forwarded to the wrapping field. */
  focusId?: string
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
  valueLabel,
  focusId
}: SettingsSliderFieldProps) => (
  <SettingsFormField
    focusId={focusId}
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
  </SettingsFormField>
)

export const SettingsValueBadge = ({
  className,
  ...props
}: React.ComponentProps<typeof Badge>) => (
  <Badge variant="outline" className={cn("font-mono", className)} {...props} />
)
