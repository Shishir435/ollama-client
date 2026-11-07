import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SETTINGS } from "@/lib/storage/settings"
import { useEmbeddingStatus } from "../use-embedding-status"

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
vi.mock("../use-native-embeddings", () => ({
  useNativeEmbeddings: () => ({ state: { mode: "external" } })
}))
vi.mock("@/features/model/hooks/use-model-pull", () => ({
  useModelPull: () => ({
    pullModel: state.pullModel,
    pullingModel: null,
    progress: null,
    cancelPull: vi.fn()
  })
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: state.call }
}))
vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: state.openOptions,
  runtime: { getURL: (path: string) => path }
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.config.sharedEmbeddingProviderId = "custom:second"
})

describe("useEmbeddingStatus", () => {
  it.each(["unavailable", "unverified", "missing"])(
    "offers setup, never an Ollama download, for remote %s",
    async (status) => {
      state.call.mockResolvedValue({
        exists: false,
        status,
        canDownload: false
      })
      const { result } = renderHook(() => useEmbeddingStatus())
      await waitFor(() =>
        expect(state.call).toHaveBeenCalledWith(
          expect.anything(),
          { model: "all-minilm:latest", providerId: "custom:second" },
          expect.anything()
        )
      )
      await waitFor(() => expect(result.current.availability).toBe(status))
      expect(result.current.canDownload).toBe(false)
      result.current.download()
      expect(state.pullModel).not.toHaveBeenCalled()
      result.current.openSetup()
      expect(state.openOptions).toHaveBeenCalled()
    }
  )

  it("downloads only a model confirmed missing on the selected Ollama", async () => {
    state.config.sharedEmbeddingProviderId = "ollama"
    state.call.mockResolvedValue({
      exists: false,
      status: "missing",
      canDownload: true
    })
    const { result } = renderHook(() => useEmbeddingStatus())
    await waitFor(() => expect(result.current.canDownload).toBe(true))
    result.current.download()
    expect(state.pullModel).toHaveBeenCalledWith("all-minilm:latest", "ollama")
  })
})
