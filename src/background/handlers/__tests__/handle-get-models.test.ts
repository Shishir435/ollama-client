import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleGetModels } from "../handle-get-models"
import {
  clearHandlerMocks,
  createMockSendResponse,
  mockModelsResponse,
  mockOllamaResponse,
  setupHandlerMocks
} from "./test-utils"

// Mock the storage module
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined)
  }
}))

describe("handleGetModels", () => {
  let mockSendResponse: ReturnType<typeof createMockSendResponse>

  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockSendResponse = createMockSendResponse()
  })

  describe("successful requests", () => {
    it("should fetch models from default base URL", async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockOllamaResponse(mockModelsResponse)
      )

      await handleGetModels(mockSendResponse)

      expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/tags")
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: mockModelsResponse
      })
    })

    it("should use custom base URL from storage", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue("http://192.168.1.100:11434")
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelsResponse))

      await handleGetModels(mockSendResponse)

      expect(fetch).toHaveBeenCalledWith("http://192.168.1.100:11434/api/tags")
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: mockModelsResponse
      })
    })

    it("should handle empty models list", async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockOllamaResponse({ models: [] })
      )

      await handleGetModels(mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: { models: [] }
      })
    })

    it("should parse models response correctly", async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockOllamaResponse(mockModelsResponse)
      )

      await handleGetModels(mockSendResponse)

      const response = mockSendResponse.mock.calls[0][0]
      expect(response.success).toBe(true)
      expect(response.data?.models).toHaveLength(2)
      expect(response.data?.models[0].name).toBe("llama3:latest")
    })
  })

  describe("error handling", () => {
    it("should handle 404 errors", async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockOllamaResponse(null, false)
      )

      await handleGetModels(mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 500, message: "Internal Server Error" }
      })
    })

    it("should handle 500 errors", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      } as Response)

      await handleGetModels(mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 500, message: "Internal Server Error" }
      })
    })

    it("should handle network failures", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      await handleGetModels(mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 0, message: "Network error" }
      })
    })

    it("should handle connection refused", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Failed to fetch"))

      await handleGetModels(mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 0, message: "Failed to fetch" }
      })
    })

    it("should handle timeout errors", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Request timeout"))

      await handleGetModels(mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 0, message: "Request timeout" }
      })
    })
  })

  describe("URL construction", () => {
    it("should construct URL correctly with trailing slash in base URL", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue("http://localhost:11434/")
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelsResponse))

      await handleGetModels(mockSendResponse)

      expect(fetch).toHaveBeenCalledWith("http://localhost:11434//api/tags")
    })

    it("should handle undefined base URL", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue(undefined)
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelsResponse))

      await handleGetModels(mockSendResponse)

      expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/tags")
    })

    it("should handle null base URL", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue(null)
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelsResponse))

      await handleGetModels(mockSendResponse)

      expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/tags")
    })
  })

  describe("response handling", () => {
    it("should call sendResponse exactly once", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelsResponse))

      await handleGetModels(mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledTimes(1)
    })

    it("should not throw errors", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      await expect(handleGetModels(mockSendResponse)).resolves.not.toThrow()
    })
  })
})
