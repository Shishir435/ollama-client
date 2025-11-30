import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleChatWithModel } from "../handle-chat-with-model"
import type { ChatWithModelMessage } from "@/types"
import {
  clearHandlerMocks,
  createMockIsPortClosed,
  createMockPort,
  mockOllamaResponse,
  setupHandlerMocks
} from "./test-utils"

// Mock dependencies
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  setAbortController: vi.fn(),
  clearAbortController: vi.fn()
}))

vi.mock("@/background/handlers/handle-chat-stream", () => ({
  handleChatStream: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  retrieveContext: vi.fn().mockResolvedValue([]),
  storeChatMessage: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/background/lib/memory-manager", () => ({
  memoryManager: {
    saveChatToMemory: vi.fn().mockResolvedValue(undefined)
  }
}))

describe("handleChatWithModel", () => {
  let mockPort: ReturnType<typeof createMockPort>
  let mockIsPortClosed: ReturnType<typeof createMockIsPortClosed>

  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockPort = createMockPort("chat-port")
    mockIsPortClosed = createMockIsPortClosed(false)
  })

  describe("successful chat requests", () => {
    it("should send chat request with correct payload", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue(undefined)
      
      const mockResponse = new Response(new ReadableStream(), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [
            { role: "user", content: "Hello" }
          ]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" }
        })
      )

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      
      expect(requestBody.model).toBe("llama3:latest")
      // DEFAULT_MODEL_CONFIG includes a system prompt, so expect 2 messages
      expect(requestBody.messages.length).toBeGreaterThanOrEqual(1)
    })

    it("should use custom base URL from storage", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue("http://192.168.1.100:11434")
      
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(fetch).toHaveBeenCalledWith(
        "http://192.168.1.100:11434/api/chat",
        expect.any(Object)
      )
    })

    it("should inject system prompt from model config", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({
        "llama3:latest": {
          system: "You are a helpful assistant",
          temperature: 0.8
        }
      })
      
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Hello" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      
      expect(requestBody.messages).toHaveLength(2)
      expect(requestBody.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant"
      })
      expect(requestBody.temperature).toBe(0.8)
    })

    it("should not inject system prompt if one already exists", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({
        "llama3:latest": {
          system: "Default system prompt"
        }
      })
      
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [
            { role: "system", content: "Custom system prompt" },
            { role: "user", content: "Hello" }
          ]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      
      expect(requestBody.messages).toHaveLength(2)
      expect(requestBody.messages[0].content).toBe("Custom system prompt")
    })
  })

  describe("message limiting for small models", () => {
    it("should limit messages for 135m models", async () => {
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" as const : "assistant" as const,
        content: `Message ${i}`
      }))

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "phi:135m",
          messages
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      // Should keep last 5 messages + possible system prompt
      expect(requestBody.messages.length).toBeGreaterThanOrEqual(5)
      expect(requestBody.messages.length).toBeLessThanOrEqual(6) // 5 messages + system
      // First user message should be from the last 5
      const firstUserMessage = requestBody.messages.find((m: { role: string }) => m.role === "user")
      expect(firstUserMessage.content).toContain("Message")
    })

    it("should limit messages for 0.6b models", async () => {
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" as const : "assistant" as const,
        content: `Message ${i}`
      }))

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "qwen:0.6b",
          messages
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      // Should keep last 5 messages + possible system prompt
      expect(requestBody.messages.length).toBeGreaterThanOrEqual(5)
      expect(requestBody.messages.length).toBeLessThanOrEqual(6)
    })

    it("should not limit messages for regular models", async () => {
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" as const : "assistant" as const,
        content: `Message ${i}`
      }))

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:8b",
          messages
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      // Should keep all 10 messages + possible system prompt
      expect(requestBody.messages.length).toBeGreaterThanOrEqual(10)
      expect(requestBody.messages.length).toBeLessThanOrEqual(11)
    })
  })

  describe("AbortController management", () => {
    it("should set AbortController on request start", async () => {
      const { setAbortController } = await import("@/background/lib/abort-controller-registry")
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(setAbortController).toHaveBeenCalledWith(
        "chat-port",
        expect.any(AbortController)
      )
    })

    it("should clear AbortController after successful completion", async () => {
      const { clearAbortController } = await import("@/background/lib/abort-controller-registry")
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(clearAbortController).toHaveBeenCalledWith("chat-port")
    })

    it("should clear AbortController after error", async () => {
      const { clearAbortController } = await import("@/background/lib/abort-controller-registry")
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(clearAbortController).toHaveBeenCalledWith("chat-port")
    })

    it("should handle AbortError specifically", async () => {
      const abortError = new Error("Aborted")
      abortError.name = "AbortError"
      vi.mocked(fetch).mockRejectedValue(abortError)

      mockIsPortClosed = createMockIsPortClosed(false)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          done: true,
          aborted: true
        })
      )
    })

    it("should not send abort message if port is closed", async () => {
      const abortError = new Error("Aborted")
      abortError.name = "AbortError"
      vi.mocked(fetch).mockRejectedValue(abortError)

      mockIsPortClosed = createMockIsPortClosed(true)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockPort.postMessage).not.toHaveBeenCalled()
    })
  })

  describe("error handling", () => {
    it("should handle non-ok responses", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      } as Response)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            status: 500,
            message: "Internal Server Error"
          }
        })
      )
    })

    it("should handle network failures", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            status: 0,
            message: expect.stringContaining("Network error")
          })
        })
      )
    })

    it("should provide user-friendly error messages", async () => {
      const error = new Error()
      vi.mocked(fetch).mockRejectedValue(error)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Unknown error occurred - try regenerating"
          })
        })
      )
    })
  })

  describe("stream handling", () => {
    it("should call handleChatStream on successful response", async () => {
      const { handleChatStream } = await import("@/background/handlers/handle-chat-stream")
      const mockResponse = new Response(new ReadableStream(), { status: 200 })
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(handleChatStream).toHaveBeenCalledWith(
        mockResponse,
        mockPort,
        mockIsPortClosed
      )
    })
  })
})
