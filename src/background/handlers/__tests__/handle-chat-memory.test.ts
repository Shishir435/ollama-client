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

// Mock dependencies
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  setAbortController: vi.fn(),
  clearAbortController: vi.fn()
}))

vi.mock("@/background/handlers/handle-chat-stream", () => ({
  handleChatStream: vi.fn()
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  retrieveContext: vi.fn(),
  storeChatMessage: vi.fn()
}))

vi.mock("@/background/lib/memory-manager", () => ({
  memoryManager: {
    saveChatToMemory: vi.fn()
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
    const { retrieveContext } = await import("@/lib/embeddings/vector-store")
    
    // Mock Memory Enabled
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.MEMORY.ENABLED) return true
      return undefined
    })

    // Mock Context Retrieval
    vi.mocked(retrieveContext).mockResolvedValue([
      "User likes pizza",
      "User lives in New York"
    ])

    const mockResponse = new Response(new ReadableStream(), { status: 200 })
    vi.mocked(fetch).mockResolvedValue(mockResponse)

    const message: ChatWithModelMessage = {
      type: "CHAT_WITH_MODEL",
      payload: {
        model: "llama3:latest",
        messages: [{ role: "user", content: "What do I like?" }],
        sessionId: "session-123"
      }
    }

    await handleChatWithModel(message, mockPort, mockIsPortClosed)

    const callArgs = vi.mocked(fetch).mock.calls[0]
    const requestBody = JSON.parse(callArgs[1]?.body as string)
    
    // Check if system prompt contains context
    const systemMessage = requestBody.messages.find((m: any) => m.role === "system")
    expect(systemMessage).toBeDefined()
    expect(systemMessage.content).toContain("context from previous conversations")
    expect(systemMessage.content).toContain("User likes pizza")
    expect(systemMessage.content).toContain("User lives in New York")
  })

  it("should NOT inject context when memory is disabled", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    const { retrieveContext } = await import("@/lib/embeddings/vector-store")
    
    // Mock Memory Disabled
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.MEMORY.ENABLED) return false
      return undefined
    })

    const mockResponse = new Response(new ReadableStream(), { status: 200 })
    vi.mocked(fetch).mockResolvedValue(mockResponse)

    const message: ChatWithModelMessage = {
      type: "CHAT_WITH_MODEL",
      payload: {
        model: "llama3:latest",
        messages: [{ role: "user", content: "What do I like?" }],
        sessionId: "session-123"
      }
    }

    await handleChatWithModel(message, mockPort, mockIsPortClosed)

    expect(retrieveContext).not.toHaveBeenCalled()
    
    const callArgs = vi.mocked(fetch).mock.calls[0]
    const requestBody = JSON.parse(callArgs[1]?.body as string)
    
    // System prompt should NOT contain context header
    const systemMessage = requestBody.messages.find((m: any) => m.role === "system")
    if (systemMessage) {
      expect(systemMessage.content).not.toContain("context from previous conversations")
    }
  })

  it("should save chat to memory after successful generation", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    const { handleChatStream } = await import("@/background/handlers/handle-chat-stream")
    const { memoryManager } = await import("@/background/lib/memory-manager")
    
    // Mock Memory Enabled
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.MEMORY.ENABLED) return true
      return undefined
    })

    // Mock Stream Response
    vi.mocked(handleChatStream).mockResolvedValue("I am an AI.")

    const mockResponse = new Response(new ReadableStream(), { status: 200 })
    vi.mocked(fetch).mockResolvedValue(mockResponse)

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
