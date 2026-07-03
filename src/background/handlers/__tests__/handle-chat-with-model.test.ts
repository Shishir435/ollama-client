import { beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import type { ChatMessage, ChatWithModelMessage } from "@/types"
import { handleChatWithModel } from "../handle-chat-with-model"
import {
  clearHandlerMocks,
  createMockIsPortClosed,
  createMockPort,
  setupHandlerMocks
} from "./test-utils"

const { mockProvider, mockStreamChat } = vi.hoisted(() => {
  const streamChat = vi.fn().mockImplementation(async (_req, onChunk) => {
    onChunk({ delta: "Hello", done: false })
    onChunk({ done: true })
  })
  return {
    mockStreamChat: streamChat,
    mockProvider: {
      id: "ollama", // string for simpler mock, or use ProviderId.OLLAMA if imported inside
      config: {
        id: "ollama",
        type: "ollama",
        enabled: true,
        baseUrl: "http://localhost:11434",
        name: "Ollama"
      },
      streamChat: streamChat,
      getModels: vi.fn().mockResolvedValue(["llama3:latest"])
    }
  }
})

// Mock dependencies
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined)
  },
  getPlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  setPlasmoStoredValue: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  setAbortController: vi.fn(),
  clearAbortController: vi.fn()
}))

vi.mock("@/features/chat/rag/rag-pipeline", () => ({
  retrieveContextEnhanced: vi.fn().mockResolvedValue([]),
  formatEnhancedResults: vi
    .fn()
    .mockReturnValue({ formattedContext: "", sources: [] })
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn().mockResolvedValue(mockProvider),
    getProvider: vi.fn().mockResolvedValue(mockProvider)
  }
}))

vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: {
    getProviders: vi.fn().mockResolvedValue([mockProvider.config]),
    getProviderConfig: vi.fn().mockResolvedValue(mockProvider.config),
    getModelMapping: vi.fn().mockResolvedValue(null),
    saveModelMappings: vi.fn().mockResolvedValue(undefined),
    updateProviderConfig: vi.fn().mockResolvedValue(undefined)
  },
  DEFAULT_PROVIDERS: [],
  PROVIDERS_STORAGE_KEY: "llm_providers_config_v1"
}))

describe("handleChatWithModel", () => {
  let mockPort: ReturnType<typeof createMockPort>
  let mockIsPortClosed: ReturnType<typeof createMockIsPortClosed>

  beforeEach(async () => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockPort = createMockPort("chat-port")
    mockIsPortClosed = createMockIsPortClosed(false)
    vi.clearAllMocks()

    // clearAllMocks resets calls but not implementations, so restore the RAG
    // mock defaults here. This makes every test start with empty memory and
    // removes the need for per-test teardown (which leaks if an assert throws).
    const rag = await import("@/features/chat/rag/rag-pipeline")
    vi.mocked(rag.retrieveContextEnhanced).mockResolvedValue([])
    vi.mocked(rag.formatEnhancedResults).mockReturnValue({
      formattedContext: "",
      sources: []
    } as never)
  })

  describe("successful chat requests", () => {
    it("should send chat request with correct payload", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Hello" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(ProviderFactory.getProviderForModel).toHaveBeenCalledWith(
        "llama3:latest",
        undefined
      )
      expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "llama3:latest",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Hello" })
          ])
        }),
        expect.any(Function),
        expect.any(AbortSignal)
      )
    })

    it("should use custom base URL from storage", async () => {
      const { ProviderFactory } = await import("@/lib/providers/factory")
      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)
      expect(ProviderFactory.getProviderForModel).toHaveBeenCalledWith(
        "llama3:latest",
        undefined
      )
    })

    it("should inject system prompt from model config", async () => {
      const { plasmoGlobalStorage } = await import(
        "@/lib/plasmo-global-storage"
      )
      vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
        if (key === STORAGE_KEYS.PROVIDER.MODEL_CONFIGS) {
          return {
            "llama3:latest": {
              system: "You are a helpful assistant",
              temperature: 0.8
            }
          }
        }
        return undefined
      })

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Hello" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: expect.stringContaining("You are a helpful assistant")
            })
          ]),
          temperature: 0.8
        }),
        expect.any(Function),
        expect.any(AbortSignal)
      )
    })

    it("should not inject system prompt if one already exists", async () => {
      const { plasmoGlobalStorage } = await import(
        "@/lib/plasmo-global-storage"
      )
      vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
        if (key === STORAGE_KEYS.PROVIDER.MODEL_CONFIGS) {
          return {
            "llama3:latest": {
              system: "Default system prompt"
            }
          }
        }
        return undefined
      })

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

      expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: "Custom system prompt" })
          ])
        }),
        expect.any(Function),
        expect.any(AbortSignal)
      )
    })

    it("caps injected memory context to the RAG char budget", async () => {
      const { plasmoGlobalStorage } = await import(
        "@/lib/plasmo-global-storage"
      )
      vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
        if (key === STORAGE_KEYS.MEMORY.ENABLED) return true
        if (key === STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS) return 20
        return undefined
      })
      const rag = await import("@/features/chat/rag/rag-pipeline")
      vi.mocked(rag.retrieveContextEnhanced).mockResolvedValue([
        { score: 1 }
      ] as never)
      const longContext = "X".repeat(100)
      vi.mocked(rag.formatEnhancedResults).mockReturnValue({
        formattedContext: longContext,
        sources: []
      } as never)

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "hi" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      const request = mockStreamChat.mock.calls[0][0]
      const systemMsg = request.messages.find(
        (m: ChatMessage) => m.role === "system"
      )
      expect(systemMsg.content).toContain("[Context truncated due to length]")
      expect(systemMsg.content).not.toContain(longContext)
      // No manual teardown needed — beforeEach restores the RAG mock defaults.
    })

    it("should include keep_alive and runtime options from model config", async () => {
      const { plasmoGlobalStorage } = await import(
        "@/lib/plasmo-global-storage"
      )
      vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
        if (key === STORAGE_KEYS.PROVIDER.MODEL_CONFIGS) {
          return {
            "llama3:latest": {
              keep_alive: "5m",
              top_k: 55,
              num_ctx: 4096,
              num_thread: 6,
              num_gpu: 1,
              num_batch: 16,
              stop: ["</s>"]
            }
          }
        }
        return undefined
      })

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Hello" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          keep_alive: "5m",
          top_k: 55,
          num_ctx: 4096,
          num_thread: 6,
          num_gpu: 1,
          num_batch: 16,
          stop: ["</s>"]
        }),
        expect.any(Function),
        expect.any(AbortSignal)
      )
    })

    it("should upgrade legacy default context before streaming", async () => {
      const { plasmoGlobalStorage } = await import(
        "@/lib/plasmo-global-storage"
      )
      vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
        if (key === STORAGE_KEYS.PROVIDER.MODEL_CONFIGS) {
          return {
            "llama3:latest": {
              num_ctx: 6144
            }
          }
        }
        return undefined
      })

      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Hello" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          num_ctx: 65536
        }),
        expect.any(Function),
        expect.any(AbortSignal)
      )
    })
  })

  describe("message limiting for small models", () => {
    it("should limit messages for 135m models", async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
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

      const callArgs = mockStreamChat.mock.calls[0][0]
      expect(callArgs.messages.length).toBeLessThanOrEqual(6) // 5 last + 1 system
    })

    it("should limit messages for 0.6b models", async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
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

      const callArgs = mockStreamChat.mock.calls[0][0]
      expect(callArgs.messages.length).toBeLessThanOrEqual(6)
    })

    it("should not limit messages for regular models", async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
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

      const callArgs = mockStreamChat.mock.calls[0][0]
      expect(callArgs.messages.length).toBeGreaterThanOrEqual(10)
    })
  })

  describe("AbortController management", () => {
    it("should set AbortController on request start", async () => {
      const { setAbortController } = await import(
        "@/background/lib/abort-controller-registry"
      )

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
      const { clearAbortController } = await import(
        "@/background/lib/abort-controller-registry"
      )

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
      const { clearAbortController } = await import(
        "@/background/lib/abort-controller-registry"
      )
      mockStreamChat.mockRejectedValueOnce(new Error("Generic error"))

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
      mockStreamChat.mockRejectedValueOnce(abortError)

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
      mockStreamChat.mockRejectedValueOnce(abortError)

      mockIsPortClosed.mockReturnValue(true)

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
    it("should handle stream errors", async () => {
      mockStreamChat.mockRejectedValueOnce(new Error("Stream failure"))

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
            message: expect.stringContaining("Stream failure")
          })
        })
      )
    })

    it("should provide user-friendly error messages", async () => {
      mockStreamChat.mockRejectedValueOnce(new Error("Unknown"))

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
            message: expect.stringContaining("Unknown")
          })
        })
      )
    })
  })

  describe("stream handling", () => {
    it("should call streamChat on provider", async () => {
      const message: ChatWithModelMessage = {
        type: "CHAT_WITH_MODEL",
        payload: {
          model: "llama3:latest",
          messages: [{ role: "user", content: "Test" }]
        }
      }

      await handleChatWithModel(message, mockPort, mockIsPortClosed)

      expect(mockStreamChat).toHaveBeenCalled()
    })
  })
})
