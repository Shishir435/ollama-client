import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react"
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

vi.mock("@/features/model/hooks/use-provider-icons", () => ({
  useProviderIcons: () => ({})
}))

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: (_key: unknown, fallback: unknown) => [fallback, vi.fn()]
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
  apiKey: { state: "replaced", value: "secret" },
  customModels: ["remote-model"]
}

const renderProviderSettings = (activeFocusId: string | null = null) =>
  render(
    <TooltipProvider>
      <ProviderSettings activeFocusId={activeFocusId} />
    </TooltipProvider>
  )

const mockProviderState = (
  overrides: Partial<ReturnType<typeof state.useProviderSettingsState>> = {}
) => {
  const handleTestConnection = vi.fn()
  const handleSave = vi.fn()
  const updateConfig = vi.fn()
  const setCustomModels = vi.fn()
  const setProviderEnabled = vi.fn()
  const setSelectedId = vi.fn()
  const addProvider = vi.fn()
  const removeProvider = vi.fn().mockResolvedValue(true)
  const discardChanges = vi.fn()

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
    saveStatus: "idle",
    discardChanges,
    providerHealth: {},
    headerStatus: { dot: "bg-status-warning", label: "not_tested" },
    handleTestConnection,
    handleSave,
    updateConfig,
    setCustomModels,
    setProviderEnabled,
    addProvider,
    removeProvider,
    ...overrides
  })

  return {
    handleTestConnection,
    handleSave,
    updateConfig,
    setCustomModels,
    setProviderEnabled,
    setSelectedId,
    addProvider,
    removeProvider,
    discardChanges
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
      screen.getAllByText("settings.providers.not_tested").length
    ).toBeGreaterThan(0)
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

    // A dirty draft is never switched away silently: the user is asked.
    fireEvent.click(screen.getByRole("tab", { name: /^OpenAI Compatible/ }))
    expect(actions.setSelectedId).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.providers.unsaved_prompt.stay"
      })
    )

    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.test" })
    )
    expect(actions.handleTestConnection).toHaveBeenCalled()

    fireEvent.change(screen.getByDisplayValue("http://localhost:11434"), {
      target: { value: "http://localhost:11435" }
    })
    expect(actions.updateConfig).toHaveBeenCalledWith({
      baseUrl: "http://localhost:11435"
    })

    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.save" })
    )
    expect(actions.handleSave).toHaveBeenCalledWith(baseProvider)
    expect(
      screen.queryByRole("button", { name: "settings.providers.add.remove" })
    ).not.toBeInTheDocument()
  })

  it("switches provider straight away when nothing is unsaved", () => {
    const actions = mockProviderState({ hasUnsavedChanges: false })
    renderProviderSettings()

    fireEvent.click(screen.getByRole("tab", { name: /^OpenAI Compatible/ }))
    expect(actions.setSelectedId).toHaveBeenCalledWith(ProviderId.OPENAI)
  })

  it("discards the draft before switching when the user chooses to", () => {
    const actions = mockProviderState({ hasUnsavedChanges: true })
    renderProviderSettings()

    fireEvent.click(screen.getByRole("tab", { name: /^OpenAI Compatible/ }))
    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.discard" })
    )
    expect(actions.discardChanges).toHaveBeenCalled()
    expect(actions.setSelectedId).toHaveBeenCalledWith(ProviderId.OPENAI, true)
  })

  it("keeps the advanced provider preferences collapsed until asked", () => {
    mockProviderState()

    const { container } = renderProviderSettings()

    expect(
      container.querySelector('[data-settings-focus-id="provider-icon-lookup"]')
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.advanced.title" })
    )
    expect(
      container.querySelector('[data-settings-focus-id="provider-icon-lookup"]')
    ).toBeInTheDocument()
  })

  it("mounts the catalog refresh control the settings registry deep-links to", () => {
    mockProviderState()

    const { container } = renderProviderSettings("provider-catalog-refresh")

    const field = container.querySelector(
      '[data-settings-focus-id="provider-catalog-refresh"]'
    )
    expect(field).toBeInTheDocument()
    // The stored value is what the queries poll on, so the trigger has to show
    // a real choice rather than an empty label.
    expect(
      within(field as HTMLElement).getByRole("combobox")
    ).toHaveTextContent("settings.providers.catalog_refresh.options.60000")
  })

  it("offers removal only for custom providers", () => {
    const customProvider = {
      ...remoteProvider,
      id: "custom:openai:test",
      name: "Custom server"
    }
    mockProviderState({
      providers: [baseProvider, customProvider],
      selectedId: customProvider.id,
      activeConfig: customProvider,
      isCustomProvider: true,
      isLocalProvider: false,
      isRemoteEndpoint: true
    })

    renderProviderSettings()

    expect(
      screen.getByRole("button", { name: "settings.providers.add.remove" })
    ).toBeInTheDocument()
  })

  it("closes the confirmation after removing its captured provider", async () => {
    const customProvider = {
      ...remoteProvider,
      id: "custom:openai:test",
      name: "Custom server"
    }
    const actions = mockProviderState({
      providers: [baseProvider, customProvider],
      selectedId: customProvider.id,
      activeConfig: customProvider,
      isCustomProvider: true,
      isLocalProvider: false,
      isRemoteEndpoint: true
    })

    renderProviderSettings()

    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.add.remove" })
    )
    const dialog = screen.getByRole("alertdialog")
    expect(
      within(dialog).getByText(
        "settings.providers.add.remove_confirm_title Custom server"
      )
    ).toBeInTheDocument()

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings.providers.add.remove"
      })
    )

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    expect(actions.removeProvider).toHaveBeenCalledWith(customProvider.id)
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
    expect(
      screen.getByText("settings.providers.add.remote_notice")
    ).toBeInTheDocument()
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
      "settings.providers.models.placeholder"
    )
    fireEvent.change(customModelInput, { target: { value: "new-model" } })
    fireEvent.keyDown(customModelInput, { key: "Enter" })
    expect(actions.setCustomModels).toHaveBeenCalledWith([
      "remote-model",
      "new-model"
    ])

    const modelChip = screen.getByText("remote-model").parentElement
    expect(modelChip).not.toBeNull()
    fireEvent.click(
      within(modelChip as HTMLElement).getByRole("button", {
        name: "settings.providers.models.remove remote-model"
      })
    )
    expect(actions.setCustomModels).toHaveBeenCalledWith([])
  })
})
