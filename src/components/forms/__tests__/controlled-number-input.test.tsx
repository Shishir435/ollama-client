import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { FormProvider, useForm } from "react-hook-form"
import { describe, expect, it, vi } from "vitest"

import { ControlledNumberInput } from "../controlled-number-input"

const NumberInputWrapper = ({
  defaultValue,
  children
}: {
  defaultValue?: number
  children: React.ReactNode
}) => {
  const methods = useForm<{ limit: number | undefined }>({
    defaultValues: { limit: defaultValue },
    mode: "onChange"
  })
  const value = methods.watch("limit")

  return (
    <FormProvider {...methods}>
      <span data-testid="watched-value">
        {value === undefined ? "<undef>" : String(value)}
      </span>
      {children}
    </FormProvider>
  )
}

describe("ControlledNumberInput", () => {
  it("renders a number input with the form default value", () => {
    render(
      <NumberInputWrapper defaultValue={12}>
        <ControlledNumberInput name="limit" aria-label="Limit" />
      </NumberInputWrapper>
    )

    expect(screen.getByLabelText("Limit")).toHaveAttribute("type", "number")
    expect(screen.getByLabelText("Limit")).toHaveValue(12)
  })

  it("writes parsed numeric changes back to React Hook Form state", () => {
    render(
      <NumberInputWrapper defaultValue={12}>
        <ControlledNumberInput name="limit" aria-label="Limit" />
      </NumberInputWrapper>
    )

    fireEvent.change(screen.getByLabelText("Limit"), {
      target: { value: "24" }
    })

    expect(screen.getByTestId("watched-value")).toHaveTextContent("24")
  })

  it("uses undefined for an intentionally cleared value", () => {
    render(
      <NumberInputWrapper defaultValue={12}>
        <ControlledNumberInput name="limit" aria-label="Limit" />
      </NumberInputWrapper>
    )

    fireEvent.change(screen.getByLabelText("Limit"), {
      target: { value: "" }
    })

    expect(screen.getByTestId("watched-value")).toHaveTextContent("<undef>")
  })

  it("keeps consumer blur handlers attached while notifying the form", () => {
    const onBlur = vi.fn()

    render(
      <NumberInputWrapper defaultValue={12}>
        <ControlledNumberInput
          name="limit"
          aria-label="Limit"
          onBlur={onBlur}
        />
      </NumberInputWrapper>
    )

    fireEvent.blur(screen.getByLabelText("Limit"))

    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})
