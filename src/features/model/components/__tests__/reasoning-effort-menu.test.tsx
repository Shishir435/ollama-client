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

  it("moves the selected model's effort along its own scale", async () => {
    render(<ReasoningEffortMenu />)

    const trigger = screen.getByRole("combobox", {
      name: "settings.model.parameters.reasoning_effort.label"
    })
    expect(useModelConfigMock).toHaveBeenCalledWith("gpt-5.6-sol", "openai")

    fireEvent.click(trigger)
    /** The trigger carries the same label, so pick the range input. */
    const controls = await screen.findAllByLabelText(
      "settings.model.parameters.reasoning_effort.label"
    )
    const slider = controls.find(
      (element) => element.tagName === "INPUT"
    ) as HTMLInputElement

    /** none, auto, low, medium, high — the model's own levels, in order. */
    fireEvent.change(slider, { target: { value: "4" } })

    expect(updateModelConfigMock).toHaveBeenCalledWith({
      reasoning_effort: "high"
    })
  })

  it("draws one stop per level the model offers", async () => {
    render(<ReasoningEffortMenu />)

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "settings.model.parameters.reasoning_effort.label"
      })
    )
    await screen.findAllByLabelText(
      "settings.model.parameters.reasoning_effort.label"
    )

    /** none, auto, low, medium, high. */
    expect(document.querySelectorAll("[data-slot=slider-mark]")).toHaveLength(5)
  })

  /**
   * The dots under the filled range were drawn in the muted colour and
   * vanished against it, so the steps below the value could not be seen.
   */
  it("marks every stop the filled range covers", async () => {
    useModelConfigMock.mockReturnValue([
      { reasoning_effort: "medium" },
      updateModelConfigMock
    ])
    render(<ReasoningEffortMenu />)

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "settings.model.parameters.reasoning_effort.label"
      })
    )
    await screen.findAllByLabelText(
      "settings.model.parameters.reasoning_effort.label"
    )

    const marks = [...document.querySelectorAll("[data-slot=slider-mark]")]
    /** none, auto, low, medium covered; high not. */
    expect(marks.map((mark) => mark.hasAttribute("data-covered"))).toEqual([
      true,
      true,
      true,
      true,
      false
    ])
  })

  it("returns the effort to the provider's own default", async () => {
    useModelConfigMock.mockReturnValue([
      { reasoning_effort: "high" },
      updateModelConfigMock
    ])
    render(<ReasoningEffortMenu />)

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "settings.model.parameters.reasoning_effort.label"
      })
    )
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.model.parameters.reasoning_effort.reset"
      })
    )

    expect(updateModelConfigMock).toHaveBeenCalledWith({
      reasoning_effort: "auto"
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
