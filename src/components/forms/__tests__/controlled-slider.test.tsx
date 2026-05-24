import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { FormProvider, useForm } from "react-hook-form"
import { describe, expect, it, vi } from "vitest"

import { ControlledSlider } from "../controlled-slider"

vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    value,
    defaultValue,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    ...props
  }: {
    value?: number[]
    defaultValue?: number[]
    onValueChange?: (value: number[]) => void
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    [key: string]: unknown
  }) => {
    const renderedValue = value?.[0] ?? defaultValue?.[0] ?? min

    return (
      <input
        {...props}
        aria-label="Controlled slider"
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={renderedValue}
        onChange={(event) => {
          onValueChange?.([Number(event.currentTarget.value)])
        }}
      />
    )
  }
}))

const SliderWrapper = ({
  defaultValue,
  children
}: {
  defaultValue?: number
  children: React.ReactNode
}) => {
  const methods = useForm<{ temperature: number | undefined }>({
    defaultValues: { temperature: defaultValue },
    mode: "onChange"
  })
  const value = methods.watch("temperature")

  return (
    <FormProvider {...methods}>
      <span data-testid="watched-value">
        {value === undefined ? "<undef>" : String(value)}
      </span>
      {children}
    </FormProvider>
  )
}

describe("ControlledSlider", () => {
  it("adapts numeric form state to the slider's array value contract", () => {
    render(
      <SliderWrapper defaultValue={0.7}>
        <ControlledSlider name="temperature" min={0} max={1} step={0.1} />
      </SliderWrapper>
    )

    expect(screen.getByLabelText("Controlled slider")).toHaveValue("0.7")
    expect(screen.getByLabelText("Controlled slider")).toHaveAttribute(
      "min",
      "0"
    )
    expect(screen.getByLabelText("Controlled slider")).toHaveAttribute(
      "max",
      "1"
    )
    expect(screen.getByLabelText("Controlled slider")).toHaveAttribute(
      "step",
      "0.1"
    )
  })

  it("writes slider changes back as a single numeric form value", () => {
    render(
      <SliderWrapper defaultValue={0.7}>
        <ControlledSlider name="temperature" min={0} max={1} step={0.1} />
      </SliderWrapper>
    )

    fireEvent.change(screen.getByLabelText("Controlled slider"), {
      target: { value: "0.4" }
    })

    expect(screen.getByTestId("watched-value")).toHaveTextContent("0.4")
  })

  it("uses the provided fallback when form state is not a number", () => {
    render(
      <SliderWrapper>
        <ControlledSlider
          name="temperature"
          min={0}
          max={1}
          step={0.1}
          fallbackValue={0.5}
        />
      </SliderWrapper>
    )

    expect(screen.getByLabelText("Controlled slider")).toHaveValue("0.5")
  })

  it("notifies consumers with the numeric slider value", () => {
    const onNumberValueChange = vi.fn()

    render(
      <SliderWrapper defaultValue={0.7}>
        <ControlledSlider
          name="temperature"
          min={0}
          max={1}
          step={0.1}
          onNumberValueChange={onNumberValueChange}
        />
      </SliderWrapper>
    )

    fireEvent.change(screen.getByLabelText("Controlled slider"), {
      target: { value: "0.3" }
    })

    expect(onNumberValueChange).toHaveBeenCalledWith(0.3)
  })

  it("passes disabled state to the underlying slider", () => {
    render(
      <SliderWrapper defaultValue={0.7}>
        <ControlledSlider
          name="temperature"
          min={0}
          max={1}
          step={0.1}
          disabled
        />
      </SliderWrapper>
    )

    expect(screen.getByLabelText("Controlled slider")).toBeDisabled()
  })
})
