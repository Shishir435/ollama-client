import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_EMBEDDING_CONFIG } from "@/lib/constants"
import { SETTINGS } from "@/lib/storage/settings"
import { EmbeddingModelSelector } from "../embedding-config/embedding-model-selector"
import { EmbeddingStatusIndicator } from "../embedding-status-indicator"

const state = vi.hoisted(() => ({
  config: {
    sharedEmbeddingModel: "all-minilm:latest",
    sharedEmbeddingProviderId: "custom:second"
  },
  call: vi.fn(),
  pullModel: vi.fn(),
  openOptions: vi.fn()
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/hooks/use-setting", () => ({
  useSetting: (setting: unknown) => [
    setting === SETTINGS.EMBEDDING_CONFIG ? state.config : "all-minilm:latest",
    vi.fn()
  ]
}))
vi.mock("@/features/model/hooks/use-native-embeddings", () => ({
  useNativeEmbeddings: () => ({ state: { mode: "external" } })
}))
vi.mock("@/features/model/hooks/use-model-pull", () => ({
  useModelPull: () => ({
    pullModel: state.pullModel,
    pullingModel: null,
    progress: null
  })
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: state.call }
}))
vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: state.openOptions,
  runtime: { getURL: (path: string) => path }
}))
vi.mock("@/components/actions", () => ({
  TooltipActionButton: ({ onClick, ariaLabel, tooltip }: any) => (
    <div>
      <button type="button" onClick={onClick}>
        {ariaLabel}
      </button>
      {tooltip}
    </div>
  )
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select
      aria-label="embedding model"
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectLabel: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectGroup: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => (
    <option value={value}>{children}</option>
  )
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.config.sharedEmbeddingProviderId = "custom:second"
})

describe("embedding provider identity", () => {
  it("keeps same-named recommended models distinct and passes the selected provider to confirmation", () => {
    const selected = vi.fn()
    render(
      <EmbeddingModelSelector
        selectedModel="all-minilm:latest"
        config={{
          ...DEFAULT_EMBEDDING_CONFIG,
          sharedEmbeddingProviderId: "custom:first"
        }}
        embeddingModels={
          [
            {
              name: "all-minilm:latest",
              providerId: "custom:first",
              providerName: "First"
            },
            {
              name: "all-minilm:latest",
              providerId: "custom:second",
              providerName: "Second"
            }
          ] as any
        }
        hasAdvancedModels={false}
        isRebuilding={false}
        rebuildProgress={null}
        onModelSelected={selected}
        onToggleShowAdvanced={vi.fn()}
      />
    )
    const second = screen.getByRole("option", {
      name: "all-minilm:latest (Second)"
    }) as HTMLOptionElement
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: second.value }
    })
    expect(selected).toHaveBeenCalledWith("all-minilm:latest", "custom:second")
    expect(
      screen.getByRole("option", { name: "all-minilm:latest (First)" })
    ).toBeInTheDocument()
  })
  it.each([
    "unavailable",
    "unverified",
    "missing"
  ])("offers setup, never an Ollama download, for remote %s", async (status) => {
    state.call.mockResolvedValue({ exists: false, status, canDownload: false })
    render(<EmbeddingStatusIndicator />)
    await waitFor(() =>
      expect(state.call).toHaveBeenCalledWith(
        expect.anything(),
        { model: "all-minilm:latest", providerId: "custom:second" },
        expect.anything()
      )
    )
    await screen.findByRole("button", { name: "common.actions.retry" })
    expect(
      screen.queryByRole("button", {
        name: "model.embedding_status.download_button"
      })
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "onboarding.provider.open_setup" })
    )
    expect(state.openOptions).toHaveBeenCalled()
    expect(state.pullModel).not.toHaveBeenCalled()
  })
  it("downloads only a model confirmed missing on the selected Ollama", async () => {
    state.config.sharedEmbeddingProviderId = "ollama"
    state.call.mockResolvedValue({
      exists: false,
      status: "missing",
      canDownload: true
    })
    render(<EmbeddingStatusIndicator />)
    fireEvent.click(
      await screen.findByRole("button", {
        name: "model.embedding_status.download_button"
      })
    )
    expect(state.pullModel).toHaveBeenCalledWith("all-minilm:latest", "ollama")
  })
})

it.each([
  true,
  false
])("keeps the selector disabled and controls the starting notice explicitly (%s)", (showRebuildNotice) => {
  render(
    <EmbeddingModelSelector
      selectedModel="all-minilm:latest"
      config={DEFAULT_EMBEDDING_CONFIG}
      embeddingModels={[]}
      hasAdvancedModels={false}
      isRebuilding
      showRebuildNotice={showRebuildNotice}
      rebuildProgress={null}
      onModelSelected={vi.fn()}
      onToggleShowAdvanced={vi.fn()}
    />
  )
  expect(screen.getByRole("combobox")).toBeDisabled()
  const notice = screen.queryByText(
    "settings.embeddings.rebuild_index.status_starting"
  )
  if (showRebuildNotice) expect(notice).toBeInTheDocument()
  else expect(notice).toBeNull()
})
