import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleDeleteModel } from "../handle-delete-model"
import {
  clearHandlerMocks,
  createMockSendResponse,
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

describe("handleDeleteModel", () => {
  let mockSendResponse: ReturnType<typeof createMockSendResponse>

  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockSendResponse = createMockSendResponse()
  })

  describe("successful deletion", () => {
    it("should delete model successfully", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse({}))

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/delete",
        expect.objectContaining({
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "llama3:latest" })
        })
      )
      expect(mockSendResponse).toHaveBeenCalledWith({ success: true })
    })

    it("should use custom base URL", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue("http://192.168.1.100:11434")
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse({}))

      await handleDeleteModel("mistral:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        "http://192.168.1.100:11434/api/delete",
        expect.any(Object)
      )
    })

    it("should send correct request body", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse({}))

      await handleDeleteModel("gemma:7b", mockSendResponse)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      
      expect(requestBody).toEqual({ model: "gemma:7b" })
    })

    it("should handle model names with tags", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse({}))

      await handleDeleteModel("llama3:8b-instruct-q4_0", mockSendResponse)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      
      expect(requestBody.model).toBe("llama3:8b-instruct-q4_0")
    })
  })

  describe("error handling", () => {
    it("should handle 404 errors for non-existent models", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Model not found")
      } as Response)

      await handleDeleteModel("nonexistent:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 404,
          message: "Model not found"
        }
      })
    })

    it("should handle 500 server errors", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Server error")
      } as Response)

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 500,
          message: "Server error"
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

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 403,
          message: "Forbidden"
        }
      })
    })

    it("should handle network failures", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 0,
          message: "Network error"
        }
      })
    })

    it("should handle connection refused", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Failed to fetch"))

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 0,
          message: "Failed to fetch"
        }
      })
    })

    it("should handle unknown errors", async () => {
      vi.mocked(fetch).mockRejectedValue({ message: undefined })

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: {
          status: 0,
          message: "Unknown error occurred"
        }
      })
    })
  })

  describe("request validation", () => {
    it("should use DELETE method", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse({}))

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "DELETE" })
      )
    })

    it("should set Content-Type header", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse({}))

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" }
        })
      )
    })

    it("should call sendResponse exactly once", async () => {
      vi.mocked(fetch).mockResolvedValue(mockOllamaResponse({}))

      await handleDeleteModel("llama3:latest", mockSendResponse)

      expect(mockSendResponse).toHaveBeenCalledTimes(1)
    })

    it("should not throw errors", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      await expect(
        handleDeleteModel("llama3:latest", mockSendResponse)
      ).resolves.not.toThrow()
    })
  })
})
