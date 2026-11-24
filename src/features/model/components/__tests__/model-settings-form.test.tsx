import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import { ModelSettingsForm } from "../model-settings-form"

const updateConfig = vi.fn()

vi.mock("react-i18next", () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn()
  })
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    selectedModel: "dolphin-llama3:latest",
    selectedProviderId: "ollama"
  })
}))

const modelConfig = vi.hoisted(() => ({
  value: undefined as Record<string, unknown> | undefined
}))
vi.mock("@/features/model/hooks/use-model-config", () => ({
  useModelConfig: () => [
    modelConfig.value ?? DEFAULT_MODEL_CONFIG,
    updateConfig
  ]
}))

const modelInfo = vi.hoisted(() => ({
  value: null as { model_info: Record<string, unknown> } | null
}))
vi.mock("@/features/model/hooks/use-model-info", () => ({
  useModelInfo: () => ({ modelInfo: modelInfo.value })
}))

vi.mock("@/features/model/components/model-info", () => ({
  ModelInfo: () => null
}))

vi.mock("@/features/model/components/loaded-models-info", () => ({
  LoadedModelsInfo: () => null
}))

vi.mock("@/features/model/components/model-menu", () => ({
  ModelMenu: () => null
}))

vi.mock("@/features/model/components/provider-status-indicator", () => ({
  ProviderStatusIndicator: () => null
}))

vi.mock("@/features/model/components/provider-version", () => ({
  ProviderVersion: () => null
}))

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => null
}))

describe("ModelSettingsForm", () => {
  beforeEach(() => {
    updateConfig.mockClear()
    modelConfig.value = undefined
    modelInfo.value = null
  })

  it("flushes system prompt edits when the settings tab unmounts before debounce", () => {
    const { unmount } = render(<ModelSettingsForm />)
    const prompt = screen.getByLabelText(
      "settings.model.system.prompt_label"
    ) as HTMLTextAreaElement

    fireEvent.change(prompt, {
      target: { value: "You are a concise coding assistant." }
    })
    unmount()

    expect(updateConfig).toHaveBeenCalledWith({
      system: "You are a concise coding assistant."
    })
  })

  it("saves system prompt edits on blur", () => {
    render(<ModelSettingsForm />)
    const prompt = screen.getByLabelText(
      "settings.model.system.prompt_label"
    ) as HTMLTextAreaElement

    fireEvent.change(prompt, {
      target: { value: "Prefer TypeScript examples." }
    })
    fireEvent.blur(prompt)

    expect(updateConfig).toHaveBeenCalledWith({
      system: "Prefer TypeScript examples."
    })
  })

  it("says Saved inline, not in a toast, once every edit was written", async () => {
    render(<ModelSettingsForm />)
    const prompt = screen.getByLabelText(
      "settings.model.system.prompt_label"
    ) as HTMLTextAreaElement

    fireEvent.change(prompt, { target: { value: "Short answers." } })
    fireEvent.blur(prompt)

    expect(
      await screen.findByText("settings.model.parameters.autosave_saved")
    ).toBeInTheDocument()
  })

  it("names a rejected value instead of claiming it saved", async () => {
    render(<ModelSettingsForm />)
    const prompt = screen.getByLabelText(
      "settings.model.system.prompt_label"
    ) as HTMLTextAreaElement
    // num_ctx below its minimum (128) must be refused, never written.
    fireEvent.change(screen.getByLabelText(/num_ctx|context/i), {
      target: { value: "50" }
    })
    fireEvent.change(prompt, { target: { value: "A change that is valid." } })
    fireEvent.blur(prompt)

    expect(
      await screen.findByText(/settings\.model\.parameters\.autosave_rejected/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText("settings.model.parameters.autosave_saved")
    ).toBeNull()
    expect(updateConfig).not.toHaveBeenCalledWith(
      expect.objectContaining({ num_ctx: 50 })
    )
  })

  describe("context size", () => {
    const contextInput = () =>
      screen.getByLabelText(/num_ctx|context/i) as HTMLInputElement

    it("shows Auto with the window a request will use", () => {
      modelInfo.value = { model_info: { "llama.context_length": 8192 } }
      render(<ModelSettingsForm />)

      expect(contextInput().value).toBe("")
      expect(contextInput().placeholder).toBe(
        "settings.model.parameters.num_ctx.auto"
      )
      expect(
        screen.getByText("settings.model.parameters.num_ctx.effective")
      ).toBeInTheDocument()
    })

    it("explains an explicit window the model's own limit holds down", () => {
      modelConfig.value = { ...DEFAULT_MODEL_CONFIG, num_ctx: 65536 }
      modelInfo.value = { model_info: { "llama.context_length": 8192 } }
      render(<ModelSettingsForm />)

      expect(contextInput().value).toBe("65536")
      expect(
        screen.getByText("settings.model.parameters.num_ctx.capped")
      ).toBeInTheDocument()
    })

    it("accepts clearing the field back to Auto without calling it invalid", () => {
      modelConfig.value = { ...DEFAULT_MODEL_CONFIG, num_ctx: 32768 }
      render(<ModelSettingsForm />)

      fireEvent.change(contextInput(), { target: { value: "" } })
      fireEvent.blur(contextInput())

      expect(
        screen.queryByText("settings.model.parameters.num_ctx.validation_min")
      ).toBeNull()
    })
  })
})
