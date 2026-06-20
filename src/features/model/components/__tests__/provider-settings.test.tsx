import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ProviderId, ProviderType } from "@/lib/providers/types"

import { ProviderSettings } from "../provider-settings"

const state = vi.hoisted(() => ({
  useProviderSettingsState: vi.fn()
}))

vi.mock("@/features/model/hooks/use-provider-settings-state", () => ({
  useProviderSettingsState: state.useProviderSettingsState
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.name ? `${key} ${values.name}` : key
  })
}))

const baseProvider = {
  id: ProviderId.OLLAMA,
  name: "Ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  baseUrl: "http://localhost:11434"
}

const remoteProvider = {
  id: ProviderId.OPENAI,
  name: "OpenAI Compatible",
  type: ProviderType.OPENAI,
  enabled: true,
  baseUrl: "https://api.example.com/v1",
  apiKey: "secret",
  customModels: ["remote-model"]
}

const renderProviderSettings = () =>
  render(
    <TooltipProvider>
      <ProviderSettings />
    </TooltipProvider>
  )

const mockProviderState = (
  overrides: Partial<ReturnType<typeof state.useProviderSettingsState>> = {}
) => {
  const handleTestConnection = vi.fn()
  const handleSave = vi.fn()
  const updateConfig = vi.fn()
  const setProviderEnabled = vi.fn()
  const setSelectedId = vi.fn()

  state.useProviderSettingsState.mockReturnValue({
    providers: [baseProvider, remoteProvider],
    loading: false,
    selectedId: baseProvider.id,
    setSelectedId,
    activeConfig: baseProvider,
    cspCompatibilityHint: null,
    isLocalProvider: true,
    isRemoteEndpoint: false,
    testingConnection: false,
    connectionStatus: null,
    hasUnsavedChanges: false,
    providerHealth: {},
    headerStatus: { dot: "bg-status-warning", label: "not_tested" },
    handleTestConnection,
    handleSave,
    updateConfig,
    setProviderEnabled,
    ...overrides
  })

  return {
    handleTestConnection,
    handleSave,
    updateConfig,
    setProviderEnabled,
    setSelectedId
  }
}

describe("ProviderSettings", () => {
  it("shows loading state", () => {
    state.useProviderSettingsState.mockReturnValue({
      loading: true,
      providers: [],
      providerHealth: {}
    })

    const { container } = renderProviderSettings()

    expect(container.querySelector(".animate-spin")).toBeInTheDocument()
  })

  it("renders selected provider controls and delegates primary actions", () => {
    const actions = mockProviderState({ hasUnsavedChanges: true })

    const { container } = renderProviderSettings()

    expect(screen.getAllByText("Ollama")).toHaveLength(2)
    expect(
      screen.getByText("settings.providers.not_tested")
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-settings-focus-id="provider-picker"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-settings-focus-id="provider-base-url"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-settings-focus-id="provider-enabled"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector(
        '[data-settings-focus-id="provider-test-connection"]'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "OpenAI Compatible" }))
    expect(actions.setSelectedId).toHaveBeenCalledWith(ProviderId.OPENAI)

    fireEvent.click(screen.getByRole("button", { name: /test/i }))
    expect(actions.handleTestConnection).toHaveBeenCalled()

    fireEvent.change(screen.getByDisplayValue("http://localhost:11434"), {
      target: { value: "http://localhost:11435" }
    })
    expect(actions.updateConfig).toHaveBeenCalledWith({
      baseUrl: "http://localhost:11435"
    })

    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    expect(actions.handleSave).toHaveBeenCalledWith(baseProvider)
  })

  it("renders remote provider fields and custom model actions", () => {
    const actions = mockProviderState({
      selectedId: remoteProvider.id,
      activeConfig: remoteProvider,
      isLocalProvider: false,
      isRemoteEndpoint: true,
      cspCompatibilityHint: "CSP hint",
      headerStatus: { dot: "bg-status-success", label: "connected" }
    })

    const { container } = renderProviderSettings()

    expect(screen.getByDisplayValue("secret")).toBeInTheDocument()
    expect(screen.getByText(/This endpoint is remote/)).toBeInTheDocument()
    expect(screen.getByText("CSP hint")).toBeInTheDocument()
    expect(
      container.querySelector('[data-settings-focus-id="provider-api-key"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector(
        '[data-settings-focus-id="provider-custom-models"]'
      )
    ).toBeInTheDocument()

    const customModelInput = screen.getByPlaceholderText(
      "e.g. google/gemini-pro"
    )
    fireEvent.change(customModelInput, { target: { value: "new-model" } })
    fireEvent.keyDown(customModelInput, { key: "Enter" })
    expect(actions.updateConfig).toHaveBeenCalledWith({
      customModels: ["remote-model", "new-model"]
    })

    const modelChip = screen.getByText("remote-model").closest("div")
    expect(modelChip).not.toBeNull()
    fireEvent.click(
      within(modelChip as HTMLElement).getByRole("button", {
        name: "common.close remote-model"
      })
    )
    expect(actions.updateConfig).toHaveBeenCalledWith({ customModels: [] })
  })
})
