import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EmbeddingModelMenuPanel } from "../embedding-model-menu-panel"

const fixture = vi.hoisted(() => ({
  mode: "bundled",
  isRebuilding: false,
  rebuildError: null as string | null,
  showAdvanced: false,
  applyModelChange: vi.fn(),
  commitModelChange: vi.fn(),
  requestModelChange: vi.fn(),
  command: vi.fn(),
  updateConfig: vi.fn()
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { model?: string }) =>
      options?.model ? `${key}:${options.model}` : key
  })
}))
vi.mock("@/features/model/hooks/use-native-embeddings", () => ({
  useNativeEmbeddings: () => ({
    state: {
      mode: fixture.mode,
      migration: "idle",
      current: 0,
      total: 0
    },
    busy: false,
    error: false,
    command: fixture.command
  })
}))
vi.mock("@/features/model/hooks/use-embedding-settings-state", () => ({
  useEmbeddingSettingsState: () => ({
    config: {
      sharedEmbeddingModel: "nomic-embed-text",
      sharedEmbeddingProviderId: "ollama",
      showAdvancedEmbeddingModels: fixture.showAdvanced
    },
    selectedModel: "nomic-embed-text",
    memoryEnabled: true,
    isLoading: false,
    hasAdvancedModels: true,
    refresh: vi.fn(),
    updateConfig: fixture.updateConfig,
    applyModelChange: fixture.applyModelChange,
    commitModelChange: fixture.commitModelChange,
    embeddingModels: [
      { name: "bge-m3", providerId: "ollama", providerName: "Ollama" },
      {
        name: "custom-embed",
        providerId: "custom:lab",
        providerName: "Lab"
      }
    ]
  })
}))
vi.mock("@/features/model/hooks/use-embedding-rebuild-workflow", () => ({
  useEmbeddingRebuildWorkflow: () => ({
    isRebuilding: fixture.isRebuilding,
    progress: fixture.isRebuilding ? { current: 2, total: 5 } : null,
    error: fixture.rebuildError,
    requestModelChange: fixture.requestModelChange,
    confirmRebuildOpen: false,
    setConfirmRebuildOpen: vi.fn(),
    rebuild: vi.fn(),
    modelChangeOpen: false,
    setModelChangeOpen: vi.fn(),
    switchModel: vi.fn(),
    switchModelAndRebuild: vi.fn()
  })
}))
vi.mock("@/features/model/hooks/use-provider-icons", () => ({
  useProviderIcons: () => ({})
}))
vi.mock("../embedding-config/embedding-rebuild-dialogs", () => ({
  EmbeddingRebuildDialogs: () => null
}))

describe("EmbeddingModelMenuPanel", () => {
  beforeEach(() => {
    fixture.mode = "bundled"
    fixture.isRebuilding = false
    fixture.rebuildError = null
    fixture.showAdvanced = true
    vi.clearAllMocks()
  })

  it("keeps a model picked from built-in mode local until confirmed, then saves it with the shared-model strategy before switching", async () => {
    let saved: () => void = () => undefined
    fixture.commitModelChange.mockImplementation(
      () => new Promise<void>((resolve) => (saved = resolve))
    )
    render(<EmbeddingModelMenuPanel />)
    fireEvent.click(screen.getByText("bge-m3"))
    expect(fixture.commitModelChange).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByText("settings.embeddings.bundled.switch_to:bge-m3")
    )
    expect(fixture.commitModelChange).toHaveBeenCalledWith(
      "bge-m3",
      "ollama",
      "shared-model"
    )
    expect(fixture.command).not.toHaveBeenCalled()
    saved()
    await waitFor(() =>
      expect(fixture.command).toHaveBeenCalledWith("external")
    )
  })

  it("persists nothing when the switch is cancelled", () => {
    render(<EmbeddingModelMenuPanel />)
    fireEvent.click(screen.getByText("bge-m3"))
    fireEvent.click(screen.getByText("common.cancel"))
    expect(fixture.applyModelChange).not.toHaveBeenCalled()
    expect(fixture.commitModelChange).not.toHaveBeenCalled()
    expect(fixture.command).not.toHaveBeenCalled()
    expect(
      screen.queryByText("settings.embeddings.bundled.switch_to:bge-m3")
    ).toBeNull()
  })

  it("locks the list and shows progress while an external rebuild runs", () => {
    fixture.mode = "external"
    fixture.isRebuilding = true
    render(<EmbeddingModelMenuPanel />)
    expect(screen.getByText("bge-m3").closest("button")).toBeDisabled()
    expect(
      screen.getByText("settings.context.embedding_health.progress")
    ).toBeInTheDocument()
  })

  it("shows a failed external rebuild", () => {
    fixture.mode = "external"
    fixture.rebuildError = "boom"
    render(<EmbeddingModelMenuPanel />)
    expect(
      screen.getByText("settings.context.embedding_health.error")
    ).toBeInTheDocument()
  })

  it("falls back to every model, named by provider on hover, when the open provider disappears", () => {
    fixture.mode = "external"
    const { rerender } = render(<EmbeddingModelMenuPanel />)
    fireEvent.click(screen.getByLabelText("Lab"))
    expect(screen.queryByText("nomic-embed-text")).toBeNull()

    fixture.showAdvanced = false
    rerender(<EmbeddingModelMenuPanel />)
    expect(screen.getByText("nomic-embed-text")).toHaveAttribute(
      "title",
      "nomic-embed-text · Ollama"
    )
  })
})
