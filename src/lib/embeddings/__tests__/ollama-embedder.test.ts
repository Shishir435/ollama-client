import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  generateEmbedding,
  generateEmbeddingsBatch,
  clearEmbeddingCache,
  getCacheStats,
  getCacheSize
} from "../ollama-embedder"

// Mock plasmo storage
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined)
  }
}))

// Mock fetch
global.fetch = vi.fn()

describe("Ollama Embedder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEmbeddingCache()
    
    // Default successful response
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] })
    } as Response)
  })

  describe("generateEmbedding", () => {
    it("should generate embedding for text", async () => {
      const text = "Hello, world!"
      const result = await generateEmbedding(text)

      expect(result).toHaveProperty("embedding")
      expect(result).toHaveProperty("model")
      if ("embedding" in result) {
        expect(result.embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
      }
    })

    it("should use specified model", async () => {
      const result = await generateEmbedding("test", "custom-model")

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse(callArgs[1]?.body as string)

      expect(body.model).toBe("custom-model")
      if ("model" in result) {
        expect(result.model).toBe("custom-model")
      }
    })

    it("should cache embeddings", async () => {
      const text = "Same text"
      
      await generateEmbedding(text)
      await generateEmbedding(text)

      // Should only call fetch once due to caching
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it("should handle API errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error"
      } as Response)

      const result = await generateEmbedding("test")

      expect(result).toHaveProperty("error")
      if ("error" in result) {
        expect(result.error).toContain("500")
      }
    })

    it("should handle network errors", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"))

      const result = await generateEmbedding("test")

      expect(result).toHaveProperty("error")
      if ("error" in result) {
        expect(result.error).toContain("Network error")
      }
    })

    it("should use custom base URL from storage", async () => {
      const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
      const { STORAGE_KEYS } = await import("@/lib/constants")
      
      vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
        if (key === STORAGE_KEYS.OLLAMA.BASE_URL) {
          return "http://192.168.1.100:11434"
        }
        return undefined
      })

      await generateEmbedding("test")

      expect(fetch).toHaveBeenCalledWith(
        "http://192.168.1.100:11434/api/embeddings",
        expect.any(Object)
      )
    })

    it("should return error for invalid response format", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: "response" })
      } as Response)

      const result = await generateEmbedding("test")

      expect(result).toHaveProperty("error")
      if ("error" in result) {
        expect(result.error).toContain("Invalid embedding response")
      }
    })
  })

  describe("generateEmbeddingsBatch", () => {
    it("should generate embeddings for multiple texts", async () => {
      const texts = ["text1", "text2", "text3"]
      
      vi.mocked(fetch).mockImplementation(async () => ({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] })
      } as Response))

      const results = await generateEmbeddingsBatch(texts)

      expect(results).toHaveLength(3)
      results.forEach(result => {
        if ("embedding" in result) {
          expect(result.embedding).toEqual([0.1, 0.2, 0.3])
        }
      })
    })

    it("should call progress callback during batch processing", async () => {
      const texts = ["text1", "text2", "text3"]
      const progressCallback = vi.fn()
      
      vi.mocked(fetch).mockImplementation(async () => ({
        ok: true,
        json: async () => ({ embedding: [0.1] })
      } as Response))

      await generateEmbeddingsBatch(texts, undefined, progressCallback)

      expect(progressCallback).toHaveBeenCalled()
    })

    it("should handle errors in batch", async () => {
      const texts = ["text1", "text2"]
      
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: [0.1] })
        } as Response)
        .mockRejectedValueOnce(new Error("API error"))

      const results = await generateEmbeddingsBatch(texts)

      expect(results).toHaveLength(2)
      expect(results[0]).toHaveProperty("embedding")
      expect(results[1]).toHaveProperty("error")
    })
  })

  describe("cache management", () => {
    it("should clear embedding cache", () => {
      clearEmbeddingCache()
      
      const size = getCacheSize()
      expect(size).toBe(0)
    })

    it("should return cache stats", async () => {
      await generateEmbedding("test1")
      await generateEmbedding("test2")

      const stats = getCacheStats()

      expect(stats.size).toBeGreaterThan(0)
      expect(stats.maxSize).toBeDefined()
    })

    it("should return cache size", async () => {
      clearEmbeddingCache()
      
      await generateEmbedding("test1")
      const size1 = getCacheSize()
      
      await generateEmbedding("test2")
      const size2 = getCacheSize()

      expect(size1).toBe(1)
      expect(size2).toBe(2)
    })
  })
})
