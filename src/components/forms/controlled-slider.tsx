import type React from "react"
import { useController, useFormContext } from "react-hook-form"

import { Slider } from "@/components/ui/slider"

type SliderProps = React.ComponentProps<typeof Slider>

export interface ControlledSliderProps
  extends Omit<
    SliderProps,
    "name" | "value" | "defaultValue" | "onValueChange"
  > {
  name: string
  fallbackValue?: number
  onNumberValueChange?: (value: number) => void
}

const toNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && !Number.isNaN(value) ? value : fallback

/**
 * React Hook Form-safe single-value slider.
 *
 * Base UI sliders expose arrays. Feature forms should deal in numbers.
 */
export const ControlledSlider = ({
  name,
  min = 0,
  fallbackValue,
  onNumberValueChange,
  ...props
}: ControlledSliderProps) => {
  const { control } = useFormContext()
  const { field } = useController({ control, name })
  const safeValue = toNumber(field.value, fallbackValue ?? min)

  return (
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
}
