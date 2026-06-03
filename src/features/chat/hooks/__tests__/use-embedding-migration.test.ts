import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useEmbeddingMigration } from "../use-embedding-migration"

const mocks = vi.hoisted(() => ({
  countMessages: vi.fn(),
  getMessagesPaginated: vi.fn(),
  // above(0).count() — how many vectors already have messageId
  vectorsWithIdCount: vi.fn(),
  // equals(id).first() — check if a specific message is already embedded
  vectorFirst: vi.fn(),
  deleteLegacy: vi.fn(),
  generateEmbedding: vi.fn(),
  storeVector: vi.fn(),
  chunkTextAsync: vi.fn()
}))

vi.mock("@/lib/repositories/chat-history", () => ({
  countMessages: mocks.countMessages,
  getMessagesPaginated: mocks.getMessagesPaginated
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  vectorDb: {
    vectors: {
      where: vi.fn(() => ({
        above: vi.fn(() => ({ count: mocks.vectorsWithIdCount })),
        equals: vi.fn(() => ({
          first: mocks.vectorFirst,
          count: vi.fn().mockResolvedValue(0),
          filter: vi.fn(() => ({ delete: mocks.deleteLegacy }))
        })),
        filter: vi.fn(() => ({ delete: mocks.deleteLegacy }))
      }))
    }
  },
  storeVector: mocks.storeVector
}))

vi.mock("@/lib/embeddings/embedding-client", () => ({
  generateEmbedding: mocks.generateEmbedding
}))

vi.mock("@/lib/embeddings/chunker", () => ({
  chunkTextAsync: mocks.chunkTextAsync
}))

vi.mock("@/lib/embeddings/config", () => ({
  getEmbeddingConfig: vi.fn().mockResolvedValue({
    chunkSize: 512,
    chunkOverlap: 50,
    chunkingStrategy: "recursive"
  })
}))

// Advance fake timers + drain microtask queue
const flush = async (ticks = 30) => {
  for (let i = 0; i < ticks; i++) {
    vi.advanceTimersByTime(100)
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.deleteLegacy.mockResolvedValue(undefined)
  mocks.storeVector.mockResolvedValue(undefined)
  mocks.chunkTextAsync.mockResolvedValue([{ text: "chunk text" }])
  mocks.generateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
  mocks.vectorFirst.mockResolvedValue(null)
  mocks.vectorsWithIdCount.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useEmbeddingMigration", () => {
  it("starts with isMigrating=false, progress=0, total=0", () => {
    mocks.countMessages.mockResolvedValue(0)
    const { result } = renderHook(() => useEmbeddingMigration())
    expect(result.current.isMigrating).toBe(false)
    expect(result.current.progress).toBe(0)
    expect(result.current.total).toBe(0)
  })

  it("does not start migration when there are zero messages", async () => {
    mocks.countMessages.mockResolvedValue(0)
    renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
    })

    expect(mocks.getMessagesPaginated).not.toHaveBeenCalled()
  })

  it("delays migration start by 5 seconds", async () => {
    mocks.countMessages.mockResolvedValue(5)

    renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(4999)
      await Promise.resolve()
    })

    expect(mocks.countMessages).not.toHaveBeenCalled()
  })

  it("cancels the startup timer on unmount", async () => {
    mocks.countMessages.mockResolvedValue(5)

    const { unmount } = renderHook(() => useEmbeddingMigration())
    unmount()

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
    })

    expect(mocks.countMessages).not.toHaveBeenCalled()
  })

  it("skips migration when vector coverage is already >= 90%", async () => {
    mocks.countMessages.mockResolvedValue(10)
    mocks.vectorsWithIdCount.mockResolvedValue(10)

    renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flush(5)
    })

    expect(mocks.getMessagesPaginated).not.toHaveBeenCalled()
  })

  it("skips system messages during migration", async () => {
    mocks.countMessages.mockResolvedValue(1)
    mocks.getMessagesPaginated
      .mockResolvedValueOnce([
        { id: 1, role: "system", content: "Be helpful.", sessionId: "s1" }
      ])
      .mockResolvedValue([])

    renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flush(20)
    })

    expect(mocks.generateEmbedding).not.toHaveBeenCalled()
  })

  it("skips incomplete assistant messages (done !== true)", async () => {
    mocks.countMessages.mockResolvedValue(1)
    mocks.getMessagesPaginated
      .mockResolvedValueOnce([
        {
          id: 1,
          role: "assistant",
          content: "Partial...",
          sessionId: "s1",
          done: false
        }
      ])
      .mockResolvedValue([])

    renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flush(20)
    })

    expect(mocks.generateEmbedding).not.toHaveBeenCalled()
  })

  it("skips messages that already have a vector with messageId", async () => {
    mocks.countMessages.mockResolvedValue(1)
    mocks.vectorFirst.mockResolvedValue({ id: 99, content: "already embedded" })
    mocks.getMessagesPaginated
      .mockResolvedValueOnce([
        { id: 42, role: "user", content: "Already embedded?", sessionId: "s1" }
      ])
      .mockResolvedValue([])

    renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flush(20)
    })

    expect(mocks.generateEmbedding).not.toHaveBeenCalled()
  })

  it("calls generateEmbedding for unembedded messages and stores the vector", async () => {
    mocks.countMessages.mockResolvedValue(1)
    mocks.getMessagesPaginated
      .mockResolvedValueOnce([
        { id: 1, role: "user", content: "What is TypeScript?", sessionId: "s1" }
      ])
      .mockResolvedValue([])

    renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flush(30)
    })

    expect(mocks.generateEmbedding).toHaveBeenCalledOnce()
    expect(mocks.storeVector).toHaveBeenCalledOnce()
  })

  it("continues without throwing when generateEmbedding returns error", async () => {
    mocks.countMessages.mockResolvedValue(1)
    mocks.getMessagesPaginated
      .mockResolvedValueOnce([
        { id: 1, role: "user", content: "Embed this please", sessionId: "s1" }
      ])
      .mockResolvedValue([])
    mocks.generateEmbedding.mockResolvedValue({ error: "Model unavailable" })

    const { result } = renderHook(() => useEmbeddingMigration())

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flush(30)
    })

    // Should complete migration without throwing
    expect(result.current.isMigrating).toBe(false)
  })
})
