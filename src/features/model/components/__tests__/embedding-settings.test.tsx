import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EmbeddingSettings } from "../embedding-settings"

const fixture = vi.hoisted(() => ({
  mode: "bundled",
  migration: "idle",
  applyModelChange: vi.fn(),
  requestModelChange: vi.fn()
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("../../hooks/use-native-embeddings", () => ({
  useNativeEmbeddings: () => ({
    state: {
      mode: fixture.mode,
      migration: fixture.migration,
      current: 0,
      total: 1
    }
  })
}))
vi.mock("../../hooks/use-embedding-settings-state", () => ({
  useEmbeddingSettingsState: () => ({
    config: {},
    embeddingModels: [],
    applyModelChange: fixture.applyModelChange
  })
}))
vi.mock("../../hooks/use-embedding-rebuild-workflow", () => ({
  useEmbeddingRebuildWorkflow: () => ({
    requestModelChange: fixture.requestModelChange
  })
}))
vi.mock("../embedding-config/embedding-model-selector", () => ({
  EmbeddingModelSelector: ({
    onModelSelected,
    isRebuilding
  }: {
    onModelSelected: (model: string, provider: string) => void
    isRebuilding: boolean
  }) => (
    <button
      type="button"
      disabled={isRebuilding}
      onClick={() => onModelSelected("multilingual-model", "custom:server")}>
      Choose external model
    </button>
  )
}))
vi.mock("@/features/knowledge/components/feedback-settings", () => ({
  FeedbackSettings: () => null
}))
vi.mock("../embedding-config/embedding-health-alert", () => ({
  EmbeddingHealthAlert: () => null
}))
vi.mock("../embedding-config/embedding-generation-config", () => ({
  EmbeddingGenerationConfig: () => null
}))
vi.mock("../embedding-config/embedding-storage-settings", () => ({
  EmbeddingStorageSettings: () => null
}))
vi.mock("../embedding-config/embedding-test-generation", () => ({
  EmbeddingTestGeneration: () => null
}))
vi.mock("../embedding-config/embedding-test-search", () => ({
  EmbeddingTestSearch: () => null
}))
vi.mock("../embedding-config/embedding-rebuild-dialogs", () => ({
  EmbeddingRebuildDialogs: () => null
}))

describe("external model selection", () => {
  beforeEach(() => {
    fixture.mode = "bundled"
    fixture.migration = "idle"
    vi.clearAllMocks()
  })
  it("lets new bundled installs configure an external target without switching the active index", () => {
    render(<EmbeddingSettings />)
    fireEvent.click(
      screen.getByRole("button", { name: "Choose external model" })
    )
    expect(fixture.applyModelChange).toHaveBeenCalledWith(
      "multilingual-model",
      "custom:server",
      "shared-model"
    )
    expect(fixture.requestModelChange).not.toHaveBeenCalled()
  })
  it("keeps the existing switch/rebuild workflow for external users", () => {
    fixture.mode = "external"
    render(<EmbeddingSettings />)
    fireEvent.click(
      screen.getByRole("button", { name: "Choose external model" })
    )
    expect(fixture.requestModelChange).toHaveBeenCalledWith(
      "multilingual-model",
      "custom:server"
    )
  })
  it("locks the target while a migration is running", () => {
    fixture.migration = "building"
    render(<EmbeddingSettings />)
    expect(
      screen.getByRole("button", { name: "Choose external model" })
    ).toBeDisabled()
  })
})
