import { useFormContext } from "react-hook-form"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
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

  return (
    <div className="space-y-3">
      <Label htmlFor={name} className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4" />}
        {label}
      </Label>
      <Slider
        id={name}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => setValue(name, v, { shouldValidate: true })}
        className="py-2"
      />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{leftLabel}</span>
          <Badge variant="outline" className="font-mono">
            {value}
          </Badge>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  )
}
