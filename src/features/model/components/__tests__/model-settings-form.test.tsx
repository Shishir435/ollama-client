import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import { ModelSettingsForm } from "../model-settings-form"

const updateConfig = vi.fn()

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn() }
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    selectedModel: "dolphin-llama3:latest",
    selectedProviderId: "ollama"
  })
}))

vi.mock("@/features/model/hooks/use-model-config", () => ({
  useModelConfig: () => [DEFAULT_MODEL_CONFIG, updateConfig]
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

  it("saves system prompt edits when the explicit save button is clicked", () => {
    render(<ModelSettingsForm />)
    const prompt = screen.getByLabelText(
      "settings.model.system.prompt_label"
    ) as HTMLTextAreaElement

    fireEvent.change(prompt, {
      target: { value: "Always answer in one sentence." }
    })
    fireEvent.click(screen.getByRole("button", { name: /common.save/i }))

    expect(updateConfig).toHaveBeenCalledWith({
      system: "Always answer in one sentence."
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
})
