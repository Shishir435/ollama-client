import type { ComponentProps, KeyboardEvent } from "react"
import { useSelectionOverlay } from "../selection-overlay-context"

const NUDGE_STEP = 12

const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-NUDGE_STEP, 0],
  ArrowRight: [NUDGE_STEP, 0],
  ArrowUp: [0, -NUDGE_STEP],
  ArrowDown: [0, NUDGE_STEP]
}

/**
 * The grip that moves the overlay. Pointer users drag it; keyboard users focus
 * it and press an arrow key, which nudges the overlay a step and pins it.
 */
export function DragHandle({
  label,
  className,
  onKeyDown: onTriggerKeyDown,
  onPointerDown: onTriggerPointerDown,
  ...props
}: ComponentProps<"button"> & {
  label: string
  className: string
}) {
  const { actions } = useSelectionOverlay()

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onTriggerKeyDown?.(event)
    if (event.defaultPrevented) return
    const step = ARROW_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    actions.nudge(step[0], step[1])
  }

  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      className={className}
      onPointerDown={(event) => {
        onTriggerPointerDown?.(event)
        if (!event.defaultPrevented) actions.startDrag(event)
      }}
      onKeyDown={onKeyDown}
    />
  )
}
