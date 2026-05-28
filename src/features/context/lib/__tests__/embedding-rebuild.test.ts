import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@/types"
import { rebuildEmbeddings } from "../embedding-rebuild"

describe("rebuildEmbeddings", () => {
  it("clears cache and vectors without embedding messages when memory is disabled", async () => {
    const clearEmbeddingCache = vi.fn()
    const clearAllVectors = vi.fn().mockResolvedValue(3)
    const getEmbeddableMessagesBySession = vi.fn()
    const embedMessages = vi.fn()
    const onProgress = vi.fn()
    const onVectorsCleared = vi.fn()

    const result = await rebuildEmbeddings({
      memoryEnabled: false,
      clearEmbeddingCache,
      clearAllVectors,
      getEmbeddableMessagesBySession,
      embedMessages,
      onProgress,
      onVectorsCleared
    })

    expect(clearEmbeddingCache).toHaveBeenCalledTimes(1)
    expect(clearAllVectors).toHaveBeenCalledTimes(1)
    expect(onVectorsCleared).toHaveBeenCalledTimes(1)
    expect(getEmbeddableMessagesBySession).not.toHaveBeenCalled()
    expect(embedMessages).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith({ current: 0, total: 0 })
    expect(result).toEqual({ current: 0, total: 0 })
  })

  it("embeds chat messages by session and reports progress", async () => {
    const clearEmbeddingCache = vi.fn()
    const clearAllVectors = vi.fn().mockResolvedValue(0)
    const embedMessages = vi.fn().mockResolvedValue(undefined)
    const onProgress = vi.fn()
    const onVectorsCleared = vi.fn()
    const sessionA: ChatMessage[] = [
      { role: "user" as const, content: "first message" }
    ]
    const sessionB: ChatMessage[] = [
      { role: "assistant" as const, content: "second message", done: true },
      { role: "user" as const, content: "third message" }
    ]

    const result = await rebuildEmbeddings({
      memoryEnabled: true,
      clearEmbeddingCache,
      clearAllVectors,
      getEmbeddableMessagesBySession: vi.fn().mockResolvedValue({
        messagesBySession: new Map([
          ["a", sessionA],
          ["empty", []],
          ["b", sessionB]
        ]),
        totalMessages: 3
      }),
      embedMessages,
      onProgress,
      onVectorsCleared,
      pauseMs: 0
    })

    expect(embedMessages).toHaveBeenNthCalledWith(1, sessionA, "a")
    expect(embedMessages).toHaveBeenNthCalledWith(2, sessionB, "b")
    expect(onProgress).toHaveBeenNthCalledWith(1, { current: 0, total: 3 })
    expect(onProgress).toHaveBeenNthCalledWith(2, { current: 1, total: 3 })
    expect(onProgress).toHaveBeenNthCalledWith(3, { current: 3, total: 3 })
    expect(onVectorsCleared).toHaveBeenCalledTimes(1)
    expect(clearAllVectors.mock.invocationCallOrder[0]).toBeLessThan(
      onVectorsCleared.mock.invocationCallOrder[0]
    )
    expect(onVectorsCleared.mock.invocationCallOrder[0]).toBeLessThan(
      embedMessages.mock.invocationCallOrder[0]
    )
    expect(result).toEqual({ current: 3, total: 3 })
  })

  it("stops before clearing vectors when cache clearing throws", async () => {
    const clearEmbeddingCache = vi.fn(() => {
      throw new Error("cache failed")
    })
    const clearAllVectors = vi.fn()

    await expect(
      rebuildEmbeddings({
        memoryEnabled: true,
        clearEmbeddingCache,
        clearAllVectors,
        getEmbeddableMessagesBySession: vi.fn(),
        embedMessages: vi.fn()
      })
    ).rejects.toThrow("cache failed")

    expect(clearAllVectors).not.toHaveBeenCalled()
  })

  it("stops before clearing existing vectors when message discovery fails", async () => {
    const clearAllVectors = vi.fn()

    await expect(
      rebuildEmbeddings({
        memoryEnabled: true,
        clearEmbeddingCache: vi.fn(),
        clearAllVectors,
        getEmbeddableMessagesBySession: vi
          .fn()
          .mockRejectedValue(new Error("source read failed")),
        embedMessages: vi.fn()
      })
    ).rejects.toThrow("source read failed")

    expect(clearAllVectors).not.toHaveBeenCalled()
  })
})
