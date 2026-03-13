import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleWarmupModel } from "@/background/handlers/handle-warmup-model"
import { STORAGE_KEYS } from "@/lib/constants"
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn()
  }
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn().mockResolvedValue({
      id: "ollama",
      config: {
        id: "ollama",
        type: "ollama",
        enabled: true,
        baseUrl: "http://localhost:11434",
        name: "Ollama"
      }
    })
  }
}))

describe("handleWarmupModel", () => {
  const sendResponse = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({})
    }) as unknown as typeof fetch
  })

  it("should warm and unload when configured", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.PROVIDER.MODEL_CONFIGS) {
        return {
          "llama3:latest": {
            warm_on_select: true,
            keep_alive: "5m"
          },
          "llama2:latest": {
            unload_on_switch: true
          }
        }
      }
      return undefined
    })

    await handleWarmupModel(
      { model: "llama3:latest", previousModel: "llama2:latest" },
      sendResponse
    )

    expect(global.fetch).toHaveBeenCalled()
    expect(sendResponse).toHaveBeenCalledWith({ success: true })
  })
})
