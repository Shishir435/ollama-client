import { render, screen } from "@testing-library/react"
import type React from "react"
import { FormProvider, useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"
import { ControlledSlider as FormSlider } from "@/components/forms"

describe("FormSlider", () => {
  it("renders label and badge", () => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const methods = useForm({ defaultValues: { temperature: 0.7 } })
      return <FormProvider {...methods}>{children}</FormProvider>
    }

    render(
      <Wrapper>
        <FormSlider
          name="temperature"
          label="Temperature"
          min={0}
          max={1}
          step={0.01}
          leftLabel="Low"
          rightLabel="High"
        />
      </Wrapper>
    )

    expect(screen.getByText("Temperature")).toBeInTheDocument()
    expect(screen.getByText("0.7")).toBeInTheDocument()
    expect(screen.getByText("Low")).toBeInTheDocument()
    expect(screen.getByText("High")).toBeInTheDocument()
  })

  it("renders slider with correct min/max attributes", () => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const methods = useForm({ defaultValues: { temperature: 0.7 } })
      return <FormProvider {...methods}>{children}</FormProvider>
    }

    const { container } = render(
      <Wrapper>
        <FormSlider
          name="temperature"
          label="Temperature"
          min={0}
          max={1}
          step={0.01}
        />
      </Wrapper>
    )

    const hiddenInput = container.querySelector('input[type="range"]')
    expect(hiddenInput).toHaveAttribute("min", "0")
    expect(hiddenInput).toHaveAttribute("max", "1")
    expect(hiddenInput).toHaveAttribute("step", "0.01")
    expect(hiddenInput).toHaveAttribute("value", "0.7")
  })

  it("initializes with correct form default value", () => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const methods = useForm({ defaultValues: { temperature: 0.7 } })
      return <FormProvider {...methods}>{children}</FormProvider>
    }

    render(
      <Wrapper>
        <FormSlider
          name="temperature"
          label="Temperature"
          min={0}
          max={1}
          step={0.01}
          leftLabel="Low"
          rightLabel="High"
        />
      </Wrapper>
    )

    expect(screen.getByText("0.7")).toBeInTheDocument()
  })
})
