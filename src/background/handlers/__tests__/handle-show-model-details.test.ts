import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleShowModelDetails } from "../handle-show-model-details"
import {
  clearHandlerMocks,
  createMockSendResponse,
  mockModelDetailsResponse,
  setupHandlerMocks
} from "./test-utils"

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn()
  }
}))

describe("handleShowModelDetails", () => {
  let mockSendResponse: ReturnType<typeof createMockSendResponse>

  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockSendResponse = createMockSendResponse()
  })

  describe("successful requests", () => {
    it("should fetch compact model details successfully", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const mockProvider = {
        id: "ollama",
        getModelDetails: vi.fn().mockResolvedValue(mockModelDetailsResponse)
      }
      vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue(
        mockProvider as any
      )

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(ProviderFactory.getProviderForModel).toHaveBeenCalledWith(
        "llama3:latest",
        undefined
      )
      expect(mockProvider.getModelDetails).toHaveBeenCalledWith("llama3:latest")
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: { details: mockModelDetailsResponse.details },
        providerId: "ollama",
        supportsDetails: true
      })
    })

    it("drops large fields that model settings does not consume", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const mockProvider = {
        id: "ollama",
        getModelDetails: vi.fn().mockResolvedValue({
          ...mockModelDetailsResponse,
          license: "large license",
          tensors: [{ name: "token_embd.weight" }],
          model_info: { "llama.context_length": 8192 },
          capabilities: ["completion"]
        })
      }
      vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue(
        mockProvider as any
      )

      await handleShowModelDetails(
        { model: "dolphin-llama3:latest", providerId: "ollama" },
        mockSendResponse
      )

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: {
          details: mockModelDetailsResponse.details,
          model_info: { "llama.context_length": 8192 },
          capabilities: ["completion"]
        },
        providerId: "ollama",
        supportsDetails: true
      })
    })

    it("should handle missing getModelDetails (non-Ollama)", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const mockProvider = {
        id: "openai-compatible",
        getModelDetails: undefined
      }
      vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue(
        mockProvider as any
      )

      await handleShowModelDetails("gpt-4", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: null,
        providerId: "openai-compatible",
        supportsDetails: false
      })
    })
  })

  describe("error handling", () => {
    it("should handle provider errors", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const mockProvider = {
        getModelDetails: vi.fn().mockRejectedValue(new Error("Provider error"))
      }
      vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue(
        mockProvider as any
      )

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 0,
          message: "Provider error"
        }
      })
    })
  })

  describe("request validation", () => {
    it("should call sendResponse exactly once", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const mockProvider = {
        getModelDetails: vi.fn().mockResolvedValue(mockModelDetailsResponse)
      }
      vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue(
        mockProvider as any
      )

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledTimes(1)
    })

    it("should not throw errors", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      vi.mocked(ProviderFactory.getProviderForModel).mockRejectedValue(
        new Error("Factory error")
      )

      await expect(
        handleShowModelDetails("llama3:latest", mockSendResponse)
      ).resolves.not.toThrow()
    })
  })
})
