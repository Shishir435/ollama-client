import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

  it("renders an automatic sentinel as a friendly empty value", () => {
    render(
      <NumberInputWrapper defaultValue={-1}>
        <ControlledNumberInput
          name="limit"
          aria-label="Limit"
          autoValue={-1}
          autoLabel="Auto (recommended)"
        />
      </NumberInputWrapper>
    )

    const input = screen.getByLabelText("Limit")
    expect(input).toHaveValue(null)
    expect(input).toHaveAttribute("placeholder", "Auto (recommended)")

    fireEvent.change(input, { target: { value: "4096" } })
    expect(screen.getByTestId("watched-value")).toHaveTextContent("4096")

    fireEvent.change(input, { target: { value: "" } })
    expect(screen.getByTestId("watched-value")).toHaveTextContent("-1")
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

  it("can defer commits until blur for unstable numeric entry", () => {
    render(
      <NumberInputWrapper defaultValue={12}>
        <ControlledNumberInput
          name="limit"
          aria-label="Limit"
          commitMode="blur"
        />
      </NumberInputWrapper>
    )

    const input = screen.getByLabelText("Limit")
    fireEvent.change(input, { target: { value: "18" } })

    expect(screen.getByTestId("watched-value")).toHaveTextContent("12")

    fireEvent.blur(input)

    expect(screen.getByTestId("watched-value")).toHaveTextContent("18")
  })

  it("marks the input invalid when validation fails", async () => {
    render(
      <NumberInputWrapper defaultValue={12}>
        <ControlledNumberInput
          name="limit"
          aria-label="Limit"
          validation={{ max: { value: 20, message: "Too high" } }}
        />
      </NumberInputWrapper>
    )

    const input = screen.getByLabelText("Limit")
    fireEvent.change(input, { target: { value: "30" } })
    fireEvent.blur(input)

    // Poll the attribute, not the element: the input exists from the first
    // render, so awaiting a query for it resolves before React Hook Form's
    // async validation has re-rendered the invalid state.
    await waitFor(() =>
      expect(screen.getByLabelText("Limit")).toHaveAttribute(
        "aria-invalid",
        "true"
      )
    )
  })
})
