import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { FormProvider, useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"

import { FormNumberInput } from "../form-number-input"

/**
 * Regression coverage for the "number inputs never save" bug.
 *
 * The shadcn `Input` is a Base UI primitive (forwards to `Field.Control`).
 * The previous implementation spread `{...register(name, ...)}` into it,
 * which silently broke the change pipeline: the input rendered fine but
 * the form state never updated, so the parent's debounced save effect
 * never observed a change and nothing was written to storage.
 *
 * The fix moves FormNumberInput onto `useController`, mirroring the
 * pattern that FormSlider already uses. These tests assert that
 * typing into the input updates the form's reported value, which is
 * the contract the parent form-save effect depends on.
 */
const TestWrapper = ({
  defaultValue,
  children
}: {
  defaultValue: number | undefined
  children: React.ReactNode
}) => {
  const methods = useForm<{ top_k: number | undefined }>({
    defaultValues: { top_k: defaultValue },
    mode: "onChange"
  })
  // Expose the form's value so assertions can read it.
  const value = methods.watch("top_k")
  return (
    <FormProvider {...methods}>
      <span data-testid="watched-value">
        {value === undefined ? "<undef>" : String(value)}
      </span>
      {children}
    </FormProvider>
  )
}

describe("FormNumberInput", () => {
  it("renders the label and the form's default value", () => {
    render(
      <TestWrapper defaultValue={40}>
        <FormNumberInput name="top_k" label="Top K" min={1} />
      </TestWrapper>
    )

    expect(screen.getByText("Top K")).toBeInTheDocument()
    expect(screen.getByLabelText("Top K")).toHaveValue(40)
  })

  it("propagates user input back to the form state (regression for register-based bug)", () => {
    render(
      <TestWrapper defaultValue={40}>
        <FormNumberInput name="top_k" label="Top K" min={1} />
      </TestWrapper>
    )

    const input = screen.getByLabelText("Top K") as HTMLInputElement
    fireEvent.change(input, { target: { value: "42" } })

    // Form state now reflects the typed value. Before the fix this
    // assertion failed -- the input visually updated but the form
    // state still held 40, so the parent's debounced save never saw
    // a change.
    expect(screen.getByTestId("watched-value").textContent).toBe("42")
  })

  it("clearing the input sets the form value to undefined (no false saves)", () => {
    render(
      <TestWrapper defaultValue={40}>
        <FormNumberInput name="top_k" label="Top K" min={1} />
      </TestWrapper>
    )

    const input = screen.getByLabelText("Top K") as HTMLInputElement
    fireEvent.change(input, { target: { value: "" } })

    expect(screen.getByTestId("watched-value").textContent).toBe("<undef>")
  })

  it("renders an empty input when no default value is provided", () => {
    render(
      <TestWrapper defaultValue={undefined}>
        <FormNumberInput name="top_k" label="Top K" min={1} />
      </TestWrapper>
    )

    expect(screen.getByLabelText("Top K")).toHaveValue(null)
  })
})
