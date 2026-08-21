import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ReasoningEffortMenu } from "../reasoning-effort-menu"

const { useProviderModelsMock, useModelConfigMock, updateModelConfigMock } =
  vi.hoisted(() => ({
    useProviderModelsMock: vi.fn(),
    useModelConfigMock: vi.fn(),
    updateModelConfigMock: vi.fn()
  }))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: useProviderModelsMock
}))

vi.mock("@/features/model/hooks/use-model-config", () => ({
  useModelConfig: useModelConfigMock
}))

describe("ReasoningEffortMenu", () => {
  beforeEach(() => {
    useModelConfigMock.mockReturnValue([
      { reasoning_effort: "auto" },
      updateModelConfigMock
    ])
    useProviderModelsMock.mockReturnValue({
      models: [
        {
          name: "gpt-5.6-sol",
          providerId: "openai",
          capabilityHints: {
            reasoning: {
              supportedEfforts: ["low", "medium", "high"],
              canDisable: true,
              canEnable: true,
              mandatory: false,
              source: "model-metadata"
            }
          }
        }
      ],
      selectedModel: "gpt-5.6-sol",
      selectedModelRef: { providerId: "openai", modelId: "gpt-5.6-sol" }
    })
  })

  it("keeps the selected model's effort control visible beside the composer", async () => {
    render(<ReasoningEffortMenu />)

    const effortSelect = screen.getByRole("combobox", {
      name: "settings.model.parameters.reasoning_effort.label"
    })
    expect(useModelConfigMock).toHaveBeenCalledWith("gpt-5.6-sol", "openai")

    fireEvent.click(effortSelect)
    const highOption = await screen.findByRole("option", {
      name: "settings.model.parameters.reasoning_effort.options.high"
    })
    fireEvent.pointerDown(highOption, { pointerType: "mouse" })
    fireEvent.click(highOption)

    expect(updateModelConfigMock).toHaveBeenCalledWith({
      reasoning_effort: "high"
    })
  })

  it("stays hidden when the selected model has no reliable effort control", () => {
    useProviderModelsMock.mockReturnValue({
      models: [{ name: "babbage-002", providerId: "openai" }],
      selectedModel: "babbage-002",
      selectedModelRef: { providerId: "openai", modelId: "babbage-002" }
    })

    render(<ReasoningEffortMenu />)

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  })
})
