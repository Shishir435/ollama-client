import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useSemanticChatSearch } from "../use-semantic-chat-search"

// Mock dependencies
vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn(() => [
    { defaultSearchLimit: 10, defaultMinSimilarity: 0.7 },
    vi.fn(),
    { setRenderValue: vi.fn(), setStoreValue: vi.fn() }
  ])
}))

vi.mock("@/lib/embeddings/ollama-embedder", () => ({
  generateEmbedding: vi.fn()
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  searchHybrid: vi.fn()
}))

vi.mock("@/lib/embeddings/auto-index", () => ({
  ensureKeywordIndexBuilt: vi.fn()
}))

describe("useSemanticChatSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with default state", () => {
    const { result } = renderHook(() => useSemanticChatSearch())

    expect(result.current).toHaveProperty("search")
    expect(result.current.isSearching).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("should return empty array for empty query", async () => {
    const { result } = renderHook(() => useSemanticChatSearch())

    const results = await result.current.search("")

    expect(results).toEqual([])
  })

  it("should perform search with results", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { searchHybrid } = await import("@/lib/embeddings/vector-store")

    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })

    vi.mocked(searchHybrid).mockResolvedValue([
      {
        document: {
          id: 1,
          content: "Test message",
          embedding: [0.1, 0.2, 0.3],
          metadata: {
            sessionId: "session-1",
            timestamp: Date.now(),
            title: "User message",
            type: "chat"
          }
        },
        similarity: 0.9
      }
    ])

    const { result } = renderHook(() => useSemanticChatSearch())

    const results = await result.current.search("test query")

    await waitFor(() => {
      expect(results).toHaveLength(1)
      expect(results[0].role).toBe("user")
      expect(results[0].sessionId).toBe("session-1")
    })
  })

  it("should handle search errors", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")

    vi.mocked(generateEmbedding).mockResolvedValue({
      error: "Embedding failed"
    })

    const { result } = renderHook(() => useSemanticChatSearch())

    const results = await result.current.search("test query")

    await waitFor(() => {
      expect(results).toEqual([])
      expect(result.current.error).toBeTruthy()
    })
  })

  it("should set searching state during search", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { searchHybrid } = await import("@/lib/embeddings/vector-store")

    let resolveEmbedding: any
    const embeddingPromise = new Promise<any>((resolve) => {
      resolveEmbedding = resolve
    })

    vi.mocked(generateEmbedding).mockReturnValue(embeddingPromise)
    vi.mocked(searchHybrid).mockResolvedValue([])

    const { result } = renderHook(() => useSemanticChatSearch())

    // Start search without awaiting
    const searchPromise = result.current.search("test")

    // Small delay to let state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Now check if searching
    expect(result.current.isSearching).toBe(true)

    // Resolve the embedding
    resolveEmbedding({ embedding: [0.1, 0.2, 0.3], model: "test-model" })

    await searchPromise

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false)
    })
  })

  it("should filter by session ID", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { searchHybrid } = await import("@/lib/embeddings/vector-store")

    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })
    vi.mocked(searchHybrid).mockResolvedValue([])

    const { result } = renderHook(() => useSemanticChatSearch())

    await result.current.search("test", { sessionId: "specific-session" })

    await waitFor(() => {
      expect(searchHybrid).toHaveBeenCalledWith(
        "test",
        [0.1, 0.2, 0.3],
        expect.objectContaining({ sessionId: "specific-session" })
      )
    })
  })

  it("should use custom limit and similarity", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { searchHybrid } = await import("@/lib/embeddings/vector-store")

    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })
    vi.mocked(searchHybrid).mockResolvedValue([])

    const { result } = renderHook(() => useSemanticChatSearch())

    await result.current.search("test", { limit: 5, minSimilarity: 0.8 })

    await waitFor(() => {
      expect(searchHybrid).toHaveBeenCalledWith(
        "test",
        [0.1, 0.2, 0.3],
        expect.objectContaining({ limit: 5, minSimilarity: 0.8 })
      )
    })
  })

  it("should identify assistant messages correctly", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { searchHybrid } = await import("@/lib/embeddings/vector-store")

    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })

    vi.mocked(searchHybrid).mockResolvedValue([
      {
        document: {
          id: 1,
          content: "Assistant response",
          embedding: [0.1, 0.2, 0.3],
          metadata: {
            sessionId: "session-1",
            timestamp: Date.now(),
            title: "Assistant response",
            type: "chat"
          }
        },
        similarity: 0.9
      }
    ])

    const { result } = renderHook(() => useSemanticChatSearch())

    const results = await result.current.search("test")

    await waitFor(() => {
      expect(results[0].role).toBe("assistant")
    })
  })

  it("should handle keyword index build failure gracefully", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { searchHybrid } = await import("@/lib/embeddings/vector-store")
    const { ensureKeywordIndexBuilt } = await import("@/lib/embeddings/auto-index")

    vi.mocked(ensureKeywordIndexBuilt).mockRejectedValue(
      new Error("Index build failed")
    )
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })
    vi.mocked(searchHybrid).mockResolvedValue([])

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() => useSemanticChatSearch())

    await result.current.search("test")

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled()
      expect(searchHybrid).toHaveBeenCalled()
    })

    consoleSpy.mockRestore()
  })
})
