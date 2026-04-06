import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderFactory } from "../factory"
import { KoboldCppProvider } from "../koboldcpp"
import { LlamaCppProvider } from "../llama-cpp"
import { LMStudioProvider } from "../lm-studio"
import { LocalAIProvider } from "../localai"
import { ProviderManager } from "../manager"
import { OllamaProvider } from "../ollama"
import { OpenAIProvider } from "../openai"
import { ProviderId, ProviderType } from "../types"
import { VllmProvider } from "../vllm"

vi.mock("../manager", () => ({
  ProviderManager: {
    getModelMapping: vi.fn(),
    getProviderConfig: vi.fn()
  }
}))

vi.mock("../ollama", () => {
  return {
    OllamaProvider: vi
      .fn()
      // biome-ignore lint: Vitest mock constructor requires regular function
      .mockImplementation(function () {
        return { id: "ollama", streamChat: vi.fn() }
      })
  }
})

vi.mock("../openai", () => {
  return {
    OpenAIProvider: vi
      .fn()
      // biome-ignore lint: Vitest mock constructor requires regular function
      .mockImplementation(function () {
        return { id: "openai", streamChat: vi.fn() }
      })
  }
})

vi.mock("../lm-studio", () => {
  return {
    LMStudioProvider: vi
      .fn()
      // biome-ignore lint: Vitest mock constructor requires regular function
      .mockImplementation(function () {
        return { id: "lm-studio", streamChat: vi.fn() }
      })
  }
})

vi.mock("../llama-cpp", () => {
  return {
    LlamaCppProvider: vi
      .fn()
      // biome-ignore lint: Vitest mock constructor requires regular function
      .mockImplementation(function () {
        return { id: "llama-cpp", streamChat: vi.fn() }
      })
  }
})

vi.mock("../vllm", () => {
  return {
    VllmProvider: vi
      .fn()
      // biome-ignore lint: Vitest mock constructor requires regular function
      .mockImplementation(function () {
        return { id: "vllm", streamChat: vi.fn() }
      })
  }
})

vi.mock("../localai", () => {
  return {
    LocalAIProvider: vi
      .fn()
      // biome-ignore lint: Vitest mock constructor requires regular function
      .mockImplementation(function () {
        return { id: "localai", streamChat: vi.fn() }
      })
  }
})

vi.mock("../koboldcpp", () => {
  return {
    KoboldCppProvider: vi
      .fn()
      // biome-ignore lint: Vitest mock constructor requires regular function
      .mockImplementation(function () {
        return { id: "koboldcpp", streamChat: vi.fn() }
      })
  }
})

describe("ProviderFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset internal instances if needed, but since it's a module level map
    // we might need to be careful. For these tests it's fine.
  })

  describe("getProvider", () => {
    it("should throw error if provider config not found", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue(null)
      await expect(ProviderFactory.getProvider("unknown")).rejects.toThrow(
        "Provider unknown not found"
      )
    })

    it("should return OllamaProvider for OLLAMA type", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: "ollama",
        name: "Ollama",
        type: ProviderType.OLLAMA,
        enabled: true,
        baseUrl: "http://localhost:11434"
      })

      const provider = await ProviderFactory.getProvider("ollama")
      expect(provider).toBeInstanceOf(Object) // Since it's mocked
      expect(OllamaProvider).toHaveBeenCalled()
    })

    it("should return LMStudioProvider for LM_STUDIO id", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: ProviderId.LM_STUDIO,
        name: "LM Studio",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://localhost:1234"
      })

      const _provider = await ProviderFactory.getProvider(ProviderId.LM_STUDIO)
      expect(LMStudioProvider).toHaveBeenCalled()
    })

    it("should return LlamaCppProvider for LLAMA_CPP id", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: ProviderId.LLAMA_CPP,
        name: "Llama.cpp",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://localhost:8080"
      })

      const _provider = await ProviderFactory.getProvider(ProviderId.LLAMA_CPP)
      expect(LlamaCppProvider).toHaveBeenCalled()
    })

    it("should return OpenAIProvider for other OPENAI type", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: "openai-custom",
        name: "Custom OpenAI",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "https://api.openai.com/v1"
      })

      const _provider = await ProviderFactory.getProvider("openai-custom")
      expect(OpenAIProvider).toHaveBeenCalled()
    })

    it("should return VllmProvider for VLLM id", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: ProviderId.VLLM,
        name: "vLLM",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://localhost:8001/v1"
      })

      const _provider = await ProviderFactory.getProvider(ProviderId.VLLM)
      expect(VllmProvider).toHaveBeenCalled()
    })

    it("should return LocalAIProvider for LocalAI id", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: ProviderId.LOCALAI,
        name: "LocalAI",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://localhost:8080/v1"
      })

      const _provider = await ProviderFactory.getProvider(ProviderId.LOCALAI)
      expect(LocalAIProvider).toHaveBeenCalled()
    })

    it("should return KoboldCppProvider for KoboldCpp id", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: ProviderId.KOBOLDCPP,
        name: "KoboldCpp",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://localhost:5001/v1"
      })

      const _provider = await ProviderFactory.getProvider(ProviderId.KOBOLDCPP)
      expect(KoboldCppProvider).toHaveBeenCalled()
    })
  })

  describe("getProviderForModel", () => {
    it("should use mapping if found", async () => {
      vi.mocked(ProviderManager.getModelMapping).mockResolvedValue({
        providerId: "custom-provider"
      })
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: "custom-provider",
        name: "Custom",
        type: ProviderType.OLLAMA,
        enabled: true,
        baseUrl: ""
      })

      await ProviderFactory.getProviderForModel("test-model")
      expect(ProviderManager.getProviderConfig).toHaveBeenCalledWith(
        "custom-provider"
      )
    })
  })
})
