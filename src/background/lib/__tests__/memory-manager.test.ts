import { beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"

const mockStoreChatMessage = vi.fn()
vi.mock("@/lib/embeddings/vector-store", () => ({
  storeChatMessage: mockStoreChatMessage
}))

const mockGet = vi.fn()
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: { get: mockGet }
}))

describe("memoryManager.saveChatToMemory", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const payload = {
    userMessage: "What is TypeScript?",
    aiResponse: "TypeScript is a typed superset of JavaScript.",
    sessionId: "session-123"
  }

  it("stores user and assistant messages when memory is enabled", async () => {
    mockGet.mockResolvedValue(true)
    mockStoreChatMessage.mockResolvedValue(undefined)

    const { memoryManager } = await import("../memory-manager")
    await memoryManager.saveChatToMemory(payload)

    expect(mockStoreChatMessage).toHaveBeenCalledTimes(2)
    expect(mockStoreChatMessage).toHaveBeenCalledWith(payload.userMessage, {
      role: "user",
      sessionId: "session-123",
      chatId: undefined
    })
    expect(mockStoreChatMessage).toHaveBeenCalledWith(payload.aiResponse, {
      role: "assistant",
      sessionId: "session-123",
      chatId: undefined
    })
  })

  it("skips storage when memory is explicitly disabled", async () => {
    mockGet.mockResolvedValue(false)

    const { memoryManager } = await import("../memory-manager")
    await memoryManager.saveChatToMemory(payload)

    expect(mockStoreChatMessage).not.toHaveBeenCalled()
  })

  it("defaults to enabled when storage returns undefined", async () => {
    mockGet.mockResolvedValue(undefined)
    mockStoreChatMessage.mockResolvedValue(undefined)

    const { memoryManager } = await import("../memory-manager")
    await memoryManager.saveChatToMemory(payload)

    expect(mockStoreChatMessage).toHaveBeenCalledTimes(2)
  })

  it("reads from STORAGE_KEYS.MEMORY.ENABLED key", async () => {
    mockGet.mockResolvedValue(true)
    mockStoreChatMessage.mockResolvedValue(undefined)

    const { memoryManager } = await import("../memory-manager")
    await memoryManager.saveChatToMemory(payload)

    expect(mockGet).toHaveBeenCalledWith(STORAGE_KEYS.MEMORY.ENABLED)
  })

  it("does not throw when storeChatMessage fails", async () => {
    mockGet.mockResolvedValue(true)
    mockStoreChatMessage.mockRejectedValue(new Error("Vector store error"))

    const { memoryManager } = await import("../memory-manager")
    await expect(
      memoryManager.saveChatToMemory(payload)
    ).resolves.toBeUndefined()
  })

  it("passes chatId when provided", async () => {
    mockGet.mockResolvedValue(true)
    mockStoreChatMessage.mockResolvedValue(undefined)

    const { memoryManager } = await import("../memory-manager")
    await memoryManager.saveChatToMemory({ ...payload, chatId: "chat-42" })

    expect(mockStoreChatMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ chatId: "chat-42" })
    )
  })
})
