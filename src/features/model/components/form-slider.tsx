import { useFormContext, useWatch } from "react-hook-form"
import { ControlledSlider } from "@/components/forms"
import { SettingsFormField } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import type { LucideIcon } from "@/lib/lucide-icon"

export interface FormSliderProps {
  name: string
  label: string
  icon?: LucideIcon
  min: number
  max: number
  step?: number
  leftLabel?: string
  rightLabel?: string
}

const toNum = (v: unknown, fallback: number): number =>
  typeof v === "number" && !Number.isNaN(v) ? v : fallback

export const FormSlider = ({
  name,
  label,
  icon: Icon,
  min,
  max,
  step = 0.01,
  leftLabel,
  rightLabel
}: FormSliderProps) => {
  const { control } = useFormContext()
  const fieldValue = useWatch({ control, name })
  const safeValue = toNum(fieldValue, min)

  return (
    <SettingsFormField
      htmlFor={name}
      label={
        Icon ? (
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </div>
        ) : (
          label
        )
      }
      className="space-y-3">
      <ControlledSlider
        id={name}
        name={name}
        min={min}
        max={max}
        step={step}
        fallbackValue={min}
        className="py-2"
      />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{leftLabel}</span>
          <Badge variant="outline" className="font-mono">
            {safeValue}
          </Badge>
          <span>{rightLabel}</span>
        </div>
      )}
    </SettingsFormField>
  )
}
