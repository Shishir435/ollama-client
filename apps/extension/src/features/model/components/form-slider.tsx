import { useFormContext } from "react-hook-form"
import { SettingsFormField } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import type { LucideIcon } from "@/lib/lucide-icon"

interface FormSliderProps {
  name: string
  label: string
  icon?: LucideIcon
  min: number
  max: number
  step?: number
  leftLabel?: string
  rightLabel?: string
}

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
  const { watch, setValue } = useFormContext()
  const value = watch(name)
  const safeValue =
    typeof value === "number" && !Number.isNaN(value) ? value : min

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
      <Slider
        id={name}
        min={min}
        max={max}
        step={step}
        value={[safeValue]}
        onValueChange={(value) =>
          setValue(name, Array.isArray(value) ? value[0] : value, {
            shouldValidate: true
          })
        }
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
