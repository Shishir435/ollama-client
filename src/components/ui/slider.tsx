import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { Fragment } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { cn } from "@/lib/class-names"

/**
 * Each size carries the thumb's own width as a length as well as a class,
 * because the stop marks have to agree with it: the thumb is edge-aligned, so
 * its centre travels from half a thumb to half a thumb short of the far end
 * rather than across the whole track, and a mark placed at a flat percentage
 * would drift from the value it names.
 */
const SLIDER_SIZES = {
  default: {
    track: "data-horizontal:h-1 data-vertical:w-1",
    thumb: "size-3",
    thumbWidth: "0.75rem"
  },
  lg: {
    track: "data-horizontal:h-2 data-vertical:w-2",
    thumb: "size-4 rounded-full",
    thumbWidth: "1rem"
  }
} as const

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  marks,
  orientation = "horizontal",
  size = "default",
  thumbProps,
  ...props
}: SliderPrimitive.Root.Props & {
  /**
   * The stops to draw on the track, for a scale whose values are a handful of
   * named steps rather than a continuous range: a count, or one label per stop
   * to name each of them in a tooltip. Horizontal sliders only.
   */
  marks?: number | readonly string[]
  /** Track and thumb weight. `lg` is for a short scale read at a glance. */
  size?: keyof typeof SLIDER_SIZES
  /** Props for every thumb — labelling, mostly. */
  thumbProps?: SliderPrimitive.Thumb.Props
}) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]
  const sizing = SLIDER_SIZES[size]
  const markLabels = Array.isArray(marks) ? marks : undefined
  const markCount = markLabels ? markLabels.length : ((marks as number) ?? 0)
  const marksShown = orientation === "horizontal" && markCount > 1

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      orientation={orientation}
      thumbAlignment="edge"
      {...props}>
      <SliderPrimitive.Control className="relative flex w-full cursor-pointer touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-control bg-muted select-none data-horizontal:w-full data-vertical:h-full",
            sizing.track
          )}>
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {/*
         * Marks sit beside the track rather than inside it: the track clips
         * its overflow, which would cut the hover area a named stop needs
         * down to the four pixels of the dot itself. Pointer events still
         * reach the control underneath, so a press on a stop moves the thumb
         * to it as a press anywhere else on the track does.
         */}
        {marksShown ? (
          /**
           * A hover delay, so dragging the thumb across the scale does not
           * flash a tooltip for every stop it passes.
           */
          <TooltipProvider delay={250}>
            {Array.from({ length: markCount }, (_, index) => {
              const fraction = index / (markCount - 1)
              const mark = (
                <span
                  aria-hidden="true"
                  data-slot="slider-mark"
                  className={cn(
                    "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-control bg-foreground/30",
                    markLabels && "after:absolute after:-inset-2"
                  )}
                  style={{
                    insetInlineStart: `calc(${fraction * 100}% + ${0.5 - fraction} * ${sizing.thumbWidth})`
                  }}
                />
              )
              const label = markLabels?.[index]
              if (!label) {
                // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional and fixed-count; index is a stable key here
                return <Fragment key={index}>{mark}</Fragment>
              }
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional and fixed-count; index is a stable key here
                <Tooltip key={index}>
                  <TooltipTrigger render={mark} />
                  <TooltipContent side="top" sideOffset={8}>
                    {label}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </TooltipProvider>
        ) : null}
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            // biome-ignore lint/suspicious/noArrayIndexKey: thumbs are positional and fixed-count; index is a stable key here
            key={index}
            {...thumbProps}
            className={cn(
              "relative block shrink-0 cursor-pointer rounded-control border border-ring bg-white ring-focus transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-2 focus-visible:ring-2 focus-visible:outline-hidden active:ring-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              sizing.thumb,
              thumbProps?.className as string | undefined
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
