"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import * as React from "react"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  onValueChange,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const normalize = React.useCallback(
    (values: number[] | undefined) =>
      values?.map((v) => (typeof v === "number" && !Number.isNaN(v) ? v : min)),
    [min]
  )
  const safeValue = React.useMemo(
    () => (Array.isArray(value) ? normalize(value) : value),
    [normalize, value]
  )
  const safeDefaultValue = React.useMemo(
    () =>
      Array.isArray(defaultValue) ? normalize(defaultValue) : defaultValue,
    [defaultValue, normalize]
  )
  const isRange = Array.isArray(safeValue)
    ? safeValue.length > 1
    : Array.isArray(safeDefaultValue)
      ? safeDefaultValue.length > 1
      : false

  const [internalValue, setInternalValue] = React.useState<number[]>(
    Array.isArray(safeDefaultValue) && safeDefaultValue.length > 0
      ? safeDefaultValue
      : [min]
  )

  React.useEffect(() => {
    if (Array.isArray(safeValue) && safeValue.length > 0) {
      setInternalValue(safeValue)
    } else if (typeof safeValue === "number" && !Number.isNaN(safeValue)) {
      setInternalValue([safeValue])
    }
  }, [safeValue])

  const effectiveValue = Array.isArray(safeValue) ? safeValue : internalValue
  const rootValue = isRange ? effectiveValue : (effectiveValue[0] ?? min)

  const _values = React.useMemo(
    () => (effectiveValue.length > 0 ? effectiveValue : [min]),
    [effectiveValue, min]
  )

  return (
    <SliderPrimitive.Root
      className={cn(
        "data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full",
        className
      )}
      data-slot="slider"
      defaultValue={safeDefaultValue}
      value={rootValue as SliderPrimitive.Root.Props["value"]}
      min={min}
      max={max}
      thumbAlignment="edge"
      onValueChange={(next, details) => {
        const nextArray = Array.isArray(next) ? next : [next]
        setInternalValue(nextArray)
        onValueChange?.(
          isRange ? (next as never) : (nextArray as never),
          details
        )
      }}
      {...props}>
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1">
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>
        {_values.map((value) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={value}
            className="relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
