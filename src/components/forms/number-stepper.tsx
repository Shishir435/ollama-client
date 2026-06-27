import type React from "react"
import { TooltipActionButton } from "@/components/actions"
import { Minus, Plus } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
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
    <div className={cn("flex items-center gap-1", className)}>
      <TooltipActionButton
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onStep(clamp(current - numericStep))}
        label="Decrease value"
        icon={<Minus />}
      />
      <ControlledNumberInput
        {...props}
        min={min}
        max={max}
        step={step}
        className="text-center"
      />
      <TooltipActionButton
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onStep(clamp(current + numericStep))}
        label="Increase value"
        icon={<Plus />}
      />
    </div>
  )
}
