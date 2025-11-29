import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useFileSearch } from "../use-file-search"

// Mock dependencies
vi.mock("@/lib/embeddings/ollama-embedder", () => ({
  generateEmbedding: vi.fn()
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  searchSimilarVectors: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn()
  }
}))

import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import { searchSimilarVectors } from "@/lib/embeddings/vector-store"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

describe("useFileSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({
      defaultSearchLimit: 10,
      defaultMinSimilarity: 0.5
    })
  })

  it("should initialize with default state", () => {
    const { result } = renderHook(() => useFileSearch())

    expect(result.current.isSearching).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("should return empty array for empty query", async () => {
    const { result } = renderHook(() => useFileSearch())

    const results = await result.current.search("")

    expect(results).toEqual([])
    expect(generateEmbedding).not.toHaveBeenCalled()
  })

  it("should search for files successfully", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })

    const mockResults = [
      {
        document: {
          id: "1",
          embedding: [0.1, 0.2, 0.3],
          text: "test content",
          metadata: {
            fileId: "file-1",
            title: "Test File",
            chunkIndex: 0,
            totalChunks: 1,
            timestamp: 123456789
          }
        },
        similarity: 0.9
      }
    ]

    vi.mocked(searchSimilarVectors).mockResolvedValue(mockResults)

    const { result } = renderHook(() => useFileSearch())

    const results = await result.current.search("test query")

    expect(results).toHaveLength(1)
    expect(results[0].fileName).toBe("Test File")
    expect(results[0].fileId).toBe("file-1")
  })

  it("should handle embedding errors", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      error: "Embedding failed",
      code: "ERROR"
    })

    const { result } = renderHook(() => useFileSearch())

    const results = await result.current.search("test")

    await waitFor(() => {
      expect(result.current.error).toBeTruthy()
    })

    expect(results).toEqual([])
  })

  it("should respect search options", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2],
      model: "test"
    })

    vi.mocked(searchSimilarVectors).mockResolvedValue([])

    const { result } = renderHook(() => useFileSearch())

    await result.current.search("query", {
      limit: 5,
      minSimilarity: 0.8,
      fileId: "specific-file"
    })

    expect(searchSimilarVectors).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({
        limit: 5,
        minSimilarity: 0.8,
        fileId: "specific-file"
      })
    )
  })
})
