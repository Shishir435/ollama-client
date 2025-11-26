import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleShowModelDetails } from "../handle-show-model-details"
import {
  clearHandlerMocks,
  createMockSendResponse,
  mockModelDetailsResponse,
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

describe("handleShowModelDetails", () => {
  let mockSendResponse: ReturnType<typeof createMockSendResponse>

  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockSendResponse = createMockSendResponse()
  })

  describe("successful requests", () => {
    it("should fetch model details successfully", async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockOllamaResponse(mockModelDetailsResponse)
      )

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/show",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "llama3:latest" })
        })
      )
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: mockModelDetailsResponse
      })
    })

    it("should use custom base URL", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue("http://192.168.1.100:11434")
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelDetailsResponse))

      await handleShowModelDetails("mistral:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        "http://192.168.1.100:11434/api/show",
        expect.any(Object)
      )
    })

    it("should handle model details with all fields", async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockOllamaResponse(mockModelDetailsResponse)
      )

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      const response = mockSendResponse.mock.calls[0][0]
      expect(response.success).toBe(true)
      expect(response.data?.modelfile).toBeDefined()
      expect(response.data?.parameters).toBeDefined()
      expect(response.data?.template).toBeDefined()
      expect(response.data?.details).toBeDefined()
    })

    it("should handle model names with tags", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelDetailsResponse))

      await handleShowModelDetails("llama3:8b-instruct-q4_0", mockSendResponse)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      
      expect(requestBody.name).toBe("llama3:8b-instruct-q4_0")
    })
  })

  describe("error handling", () => {
    it("should handle 404 errors for non-existent models", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found"
      } as Response)

      await handleShowModelDetails("nonexistent:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 404,
          message: "Not Found"
        }
      })
    })

    it("should handle 500 server errors", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      } as Response)

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 500,
          message: "Internal Server Error"
        }
      })
    })

    it("should handle network failures", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 0,
          message: "Network error"
        }
      })
    })

    it("should fallback to statusText if no error text", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("")
      } as Response)

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 403,
          message: "Forbidden"
        }
      })
    })
  })

  describe("request validation", () => {
    it("should use POST method", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelDetailsResponse))

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "POST" })
      )
    })

    it("should set Content-Type header", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelDetailsResponse))

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" }
        })
      )
    })

    it("should send correct request body", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelDetailsResponse))

      await handleShowModelDetails("gemma:7b", mockSendResponse)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      
      expect(requestBody).toEqual({ name: "gemma:7b" })
    })

    it("should call sendResponse exactly once", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse(mockModelDetailsResponse))

      await handleShowModelDetails("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledTimes(1)
    })

    it("should not throw errors", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      await expect(
        handleShowModelDetails("llama3:latest", mockSendResponse)
      ).resolves.not.toThrow()
    })
  })
})
