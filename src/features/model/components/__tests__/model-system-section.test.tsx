import { fireEvent, render, screen } from "@testing-library/react"
import { FormProvider, useForm } from "react-hook-form"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import { ModelSystemSection } from "../model-system-section"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const renderSection = ({
  onSave = vi.fn(),
  onResetSystemPrompt = vi.fn()
}: {
  onSave?: () => void
  onResetSystemPrompt?: () => void
} = {}) => {
  const updateConfig = vi.fn()

  const Wrapper = () => {
    const methods = useForm({
      defaultValues: {
        system: DEFAULT_MODEL_CONFIG.system
      }
    })
    const systemValue = methods.watch("system")

    return (
      <FormProvider {...methods}>
        <span data-testid="watched-system">{systemValue}</span>
        <ModelSystemSection
          config={DEFAULT_MODEL_CONFIG}
          updateConfig={updateConfig}
          onSave={onSave}
          onResetSystemPrompt={onResetSystemPrompt}
        />
      </FormProvider>
    )
  }

  render(<Wrapper />)

  return { updateConfig, onSave, onResetSystemPrompt }
}

describe("ModelSystemSection", () => {
  it("propagates system prompt typing into form state", () => {
    renderSection()

    fireEvent.change(
      screen.getByLabelText("settings.model.system.prompt_label"),
      { target: { value: "Use short answers." } }
    )

    expect(screen.getByTestId("watched-system")).toHaveTextContent(
      "Use short answers."
    )
  })

  it("exposes an explicit save action for system prompt edits", () => {
    const onSave = vi.fn()
    renderSection({ onSave })

    fireEvent.click(screen.getByRole("button", { name: /common.save/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("exposes a reset-to-default action for the system prompt", () => {
    const onResetSystemPrompt = vi.fn()
    renderSection({ onResetSystemPrompt })

    fireEvent.click(
      screen.getByRole("button", { name: /settings.prompts.reset/i })
    )

    expect(onResetSystemPrompt).toHaveBeenCalledTimes(1)
  })
})
