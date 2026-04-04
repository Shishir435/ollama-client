import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleShowModelDetails } from "../handle-show-model-details"
import {
  clearHandlerMocks,
  createMockSendResponse,
  mockModelDetailsResponse,
  setupHandlerMocks
} from "./test-utils"

// Mock the storage module
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

// Mock ProviderFactory
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
    it("should fetch model details successfully", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const mockProvider = {
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
        data: mockModelDetailsResponse
      })
    })

    it("should handle missing getModelDetails (non-Ollama)", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const mockProvider = {
        getModelDetails: undefined
      }
      vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue(
        mockProvider as any
      )

      await handleShowModelDetails("gpt-4", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: null
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
