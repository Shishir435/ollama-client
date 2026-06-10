import type React from "react"
import { useController, useFormContext, useWatch } from "react-hook-form"

import { SettingsFormField } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import type { LucideIcon } from "@/lib/lucide-icon"

type SliderProps = React.ComponentProps<typeof Slider>

export interface ControlledSliderProps
  extends Omit<
    SliderProps,
    "name" | "value" | "defaultValue" | "onValueChange"
  > {
  name: string
  fallbackValue?: number
  onNumberValueChange?: (value: number) => void
  label?: string
  icon?: LucideIcon
  leftLabel?: string
  rightLabel?: string
}

const toNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && !Number.isNaN(value) ? value : fallback

/**
 * React Hook Form-safe single-value slider.
 *
 * Base UI sliders expose arrays. Feature forms should deal in numbers.
 * Optionally renders a SettingsFormField wrapper with badge when `label` is provided.
 */
export const ControlledSlider = ({
  name,
  min = 0,
  fallbackValue,
  onNumberValueChange,
  label,
  icon: Icon,
  leftLabel,
  rightLabel,
  ...props
}: ControlledSliderProps) => {
  const { control } = useFormContext()
  const { field } = useController({ control, name })
  const fieldValue = useWatch({ control, name })
  const safeValue = toNumber(field.value, fallbackValue ?? min)
  const displayValue = toNumber(fieldValue, min)

  const slider = (
    <Slider
      {...props}
      min={min}
      value={[safeValue]}
      onValueChange={(value) => {
        const next = Array.isArray(value) ? value[0] : value
        field.onChange(next)
        onNumberValueChange?.(next)
      }}
    />
  )

  if (!label) return slider

  return (
    <SettingsFormField
      htmlFor={name}
      label={
        Icon ? (
          <div className="flex items-center gap-2">
            <Icon className="icon-md" />
            <span>{label}</span>
          </div>
        ) : (
          label
        )
      }
      className="space-y-3">
      {slider}
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{leftLabel}</span>
          <Badge variant="outline" className="font-mono">
            {displayValue}
          </Badge>
          <span>{rightLabel}</span>
        </div>
      )}
    </SettingsFormField>
  )
}
