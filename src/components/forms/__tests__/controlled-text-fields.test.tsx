import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { FormProvider, useForm } from "react-hook-form"
import { describe, expect, it, vi } from "vitest"

import { ControlledTextInput } from "../controlled-text-input"
import { ControlledTextarea } from "../controlled-textarea"

const TextFieldWrapper = ({
  defaultValue,
  children
}: {
  defaultValue?: string
  children: React.ReactNode
}) => {
  const methods = useForm<{ prompt: string | undefined }>({
    defaultValues: { prompt: defaultValue },
    mode: "onChange"
  })
  const value = methods.watch("prompt")

  return (
    <FormProvider {...methods}>
      <span data-testid="watched-value">{value ?? "<undef>"}</span>
      {children}
    </FormProvider>
  )
}

describe("ControlledTextInput", () => {
  it("writes text changes back to React Hook Form state", () => {
    render(
      <TextFieldWrapper defaultValue="old">
        <ControlledTextInput name="prompt" aria-label="Prompt" />
      </TextFieldWrapper>
    )

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "new" }
    })

    expect(screen.getByTestId("watched-value")).toHaveTextContent("new")
  })

  it("keeps consumer blur handlers attached while notifying the form", () => {
    const onBlur = vi.fn()

    render(
      <TextFieldWrapper defaultValue="old">
        <ControlledTextInput
          name="prompt"
          aria-label="Prompt"
          onBlur={onBlur}
        />
      </TextFieldWrapper>
    )

    fireEvent.blur(screen.getByLabelText("Prompt"))

    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})

describe("ControlledTextarea", () => {
  it("writes textarea changes back to React Hook Form state", () => {
    render(
      <TextFieldWrapper defaultValue="old">
        <ControlledTextarea name="prompt" aria-label="Prompt" />
      </TextFieldWrapper>
    )

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "new" }
    })

    expect(screen.getByTestId("watched-value")).toHaveTextContent("new")
  })

  it("keeps consumer blur handlers attached while notifying the form", () => {
    const onBlur = vi.fn()

    render(
      <TextFieldWrapper defaultValue="old">
        <ControlledTextarea name="prompt" aria-label="Prompt" onBlur={onBlur} />
      </TextFieldWrapper>
    )

    fireEvent.blur(screen.getByLabelText("Prompt"))

    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})
