import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleChatWithModel } from "../handle-chat-with-model"
import type { ChatWithModelMessage } from "@/types"
import {
  clearHandlerMocks,
  createMockIsPortClosed,
  createMockPort,
  setupHandlerMocks
} from "./test-utils"
import { STORAGE_KEYS } from "@/lib/constants"

const { mockProvider, mockStreamChat } = vi.hoisted(() => {
  const streamChat = vi.fn().mockImplementation(async (req, onChunk) => {
    onChunk({ delta: "I am an AI.", done: false })
    onChunk({ done: true })
  })
  return {
    mockStreamChat: streamChat,
    mockProvider: {
      id: "ollama",
      config: { 
        id: "ollama", 
        type: "ollama", 
        enabled: true, 
        baseUrl: "http://localhost:11434", 
        name: "Ollama" 
      },
      streamChat: streamChat,
      getModels: vi.fn()
    }
  }
})

// Mock dependencies
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  setAbortController: vi.fn(),
  clearAbortController: vi.fn()
}))

vi.mock("@/features/chat/rag/rag-pipeline", () => ({
  retrieveContextEnhanced: vi.fn().mockResolvedValue([]),
  formatEnhancedResults: vi.fn().mockReturnValue({ formattedContext: "", sources: [] })
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
    getModelMapping: vi.fn().mockResolvedValue(null)
  },
  DEFAULT_PROVIDERS: []
}))

vi.mock("@/background/lib/memory-manager", () => ({
  memoryManager: {
    saveChatToMemory: vi.fn().mockResolvedValue(undefined)
  }
}))

describe("handleChatWithModel - Contextual Memory", () => {
  let mockPort: ReturnType<typeof createMockPort>
  let mockIsPortClosed: ReturnType<typeof createMockIsPortClosed>

  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockPort = createMockPort("chat-port")
    mockIsPortClosed = createMockIsPortClosed(false)
    vi.clearAllMocks()
  })

  it("should inject context when memory is enabled", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    const { retrieveContextEnhanced, formatEnhancedResults } = await import("@/features/chat/rag/rag-pipeline")
    
    // Mock Memory Enabled
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.MEMORY.ENABLED) return true
      return undefined
    })

    // Mock Context Retrieval
    vi.mocked(retrieveContextEnhanced).mockResolvedValue([
      { document: { content: "User likes pizza", metadata: {} }, score: 0.9 },
      { document: { content: "User lives in New York", metadata: {} }, score: 0.8 }
    ] as any)
    vi.mocked(formatEnhancedResults).mockReturnValue({
      formattedContext: "- User likes pizza\n- User lives in New York",
      sources: []
    } as any)

    const message: ChatWithModelMessage = {
      type: "CHAT_WITH_MODEL",
      payload: {
        model: "llama3:latest",
        messages: [{ role: "user", content: "What do I like?" }],
        sessionId: "session-123"
      }
    }

    await handleChatWithModel(message, mockPort, mockIsPortClosed)

    expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
            messages: expect.arrayContaining([
                expect.objectContaining({
                    role: "system",
                    content: expect.stringContaining("context from previous conversations")
                })
            ])
        }),
        expect.any(Function),
        expect.any(AbortSignal)
    )
  })

  it("should NOT inject context when memory is disabled", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    const { retrieveContextEnhanced } = await import("@/features/chat/rag/rag-pipeline")
    
    // Mock Memory Disabled
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.MEMORY.ENABLED) return false
      return undefined
    })

    const message: ChatWithModelMessage = {
      type: "CHAT_WITH_MODEL",
      payload: {
        model: "llama3:latest",
        messages: [{ role: "user", content: "What do I like?" }],
        sessionId: "session-123"
      }
    }

    await handleChatWithModel(message, mockPort, mockIsPortClosed)

    expect(retrieveContextEnhanced).not.toHaveBeenCalled()
    
    expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
            messages: expect.not.arrayContaining([
                expect.objectContaining({
                    content: expect.stringContaining("context from previous conversations")
                })
            ])
        }),
        expect.any(Function),
        expect.any(AbortSignal)
    )
  })

  it("should save chat to memory after successful generation", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    const { memoryManager } = await import("@/background/lib/memory-manager")
    
    // Mock Memory Enabled
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.MEMORY.ENABLED) return true
      return undefined
    })

    const message: ChatWithModelMessage = {
      type: "CHAT_WITH_MODEL",
      payload: {
        model: "llama3:latest",
        messages: [{ role: "user", content: "Who are you?" }],
        sessionId: "session-123"
      }
    }

    await handleChatWithModel(message, mockPort, mockIsPortClosed)

    expect(memoryManager.saveChatToMemory).toHaveBeenCalledWith({
      userMessage: "Who are you?",
      aiResponse: "I am an AI.",
      sessionId: "session-123",
      chatId: undefined
    })
  })
})
