import type React from "react"
import { Button } from "@/components/ui/button"
import { Minus, Plus } from "@/lib/lucide-icon"
import { ControlledNumberInput } from "./controlled-number-input"

export interface NumberStepperProps
  extends Omit<
    React.ComponentProps<typeof ControlledNumberInput>,
    "className"
  > {
  value: number | undefined
  onStep: (next: number) => void
  className?: string
}

export const NumberStepper = ({
  value,
  onStep,
  min,
  max,
  step = 1,
  className,
  ...props
}: NumberStepperProps) => {
  const numericStep = typeof step === "number" ? step : Number(step) || 1
  const current = typeof value === "number" ? value : Number(min) || 0

  const clamp = (next: number) => {
    if (typeof min === "number" && next < min) return min
    if (typeof max === "number" && next > max) return max
    return next
  }

  return (
    <div className={className ?? "flex items-center gap-1"}>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onStep(clamp(current - numericStep))}
        aria-label="Decrease value">
        <Minus />
      </Button>
      <ControlledNumberInput
        {...props}
        min={min}
        max={max}
        step={step}
        className="text-center"
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onStep(clamp(current + numericStep))}
        aria-label="Increase value">
        <Plus />
      </Button>
    </div>
  )
}
