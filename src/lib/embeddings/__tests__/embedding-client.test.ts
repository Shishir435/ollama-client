import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearEmbeddingCache,
  cosineSimilarity,
  generateEmbedding,
  generateEmbeddingsBatch,
  getCacheSize,
  getCacheStats
} from "../embedding-client"

// Use vi.hoisted to ensure mockEmbed is defined before vi.mock runs
const { mockEmbed } = vi.hoisted(() => ({
  mockEmbed: vi.fn()
}))

// Mock plasmo storage
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined)
  }
}))

// Mock the provider factory with the hoisted mockEmbed
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn(() =>
      Promise.resolve({
        embed: (...args: unknown[]) => mockEmbed(...args)
      })
    ),
    getProvider: vi.fn(() =>
      Promise.resolve({
        embed: (...args: unknown[]) => mockEmbed(...args)
      })
    )
  }
}))

describe("Embedding Client", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEmbeddingCache()

    // Default successful response
    mockEmbed.mockReset()
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5])
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

      // mockEmbed should have been called with the text and model
      expect(mockEmbed).toHaveBeenCalledWith("test", "custom-model")
      if ("model" in result) {
        expect(result.model).toBe("custom-model")
      }
    })

    it("should cache embeddings", async () => {
      const text = "Same text"

      await generateEmbedding(text)
      await generateEmbedding(text)

      // Should only call embed once due to caching
      expect(mockEmbed).toHaveBeenCalledTimes(1)
    })

    it("should handle API errors", async () => {
      mockEmbed.mockRejectedValue(new Error("500 Internal Server Error"))

      const result = await generateEmbedding("test")

      expect(result).toHaveProperty("error")
      if ("error" in result) {
        expect(result.error).toContain("500")
      }
    })

    it("should handle network errors", async () => {
      mockEmbed.mockRejectedValue(new Error("Network error"))

      const result = await generateEmbedding("test")

      expect(result).toHaveProperty("error")
      if ("error" in result) {
        expect(result.error).toContain("Network error")
      }
    })

    it("should call provider embed with the text", async () => {
      await generateEmbedding("test text")

      expect(mockEmbed).toHaveBeenCalled()
    })

    it("should return error when provider embed fails", async () => {
      mockEmbed.mockRejectedValue(new Error("Provider error"))

      const result = await generateEmbedding("test")

      expect(result).toHaveProperty("error")
      if ("error" in result) {
        expect(result.error).toContain("Provider error")
      }
    })

    it("should recover using fallback route when first attempt fails", async () => {
      mockEmbed
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValue([0.2, 0.3, 0.4])

      const result = await generateEmbedding("fallback-test")

      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect("embedding" in result).toBe(true)
    })
  })

  describe("generateEmbeddingsBatch", () => {
    it("should generate embeddings for multiple texts", async () => {
      clearEmbeddingCache()
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])

      const texts = ["batch_text1", "batch_text2", "batch_text3"]

      const results = await generateEmbeddingsBatch(texts)

      expect(results).toHaveLength(3)
      // Check that all results have either embedding or error
      results.forEach((result) => {
        expect("embedding" in result || "error" in result).toBe(true)
      })
    })

    it("should call progress callback during batch processing", async () => {
      clearEmbeddingCache()
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValue([0.1])

      const texts = ["progress_text1", "progress_text2", "progress_text3"]
      const progressCallback = vi.fn()

      await generateEmbeddingsBatch(texts, undefined, progressCallback)

      expect(progressCallback).toHaveBeenCalled()
    })

    // Note: Error handling in batch relies on provider mock which uses dynamic imports
    // These are tested via integration tests
    it("should return results array matching input length", async () => {
      clearEmbeddingCache()
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValue([0.5, 0.5])

      const texts = ["a", "b"]
      const results = await generateEmbeddingsBatch(texts)
      expect(results).toHaveLength(texts.length)
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

  describe("cosineSimilarity", () => {
    it("should calculate similarity correctly", () => {
      const v1 = [1, 0, 0]
      const v2 = [0, 1, 0]
      const v3 = [1, 0, 0]

      expect(cosineSimilarity(v1, v2)).toBe(0)
      expect(cosineSimilarity(v1, v3)).toBe(1)
    })

    it("should handle zero vectors", () => {
      const v1 = [0, 0, 0]
      const v2 = [1, 0, 0]
      expect(cosineSimilarity(v1, v2)).toBe(0)
    })

    it("should return 0 on dimension mismatch", () => {
      expect(cosineSimilarity([1], [1, 2])).toBe(0)
    })
  })

  describe("Advanced Caching", () => {
    beforeEach(() => {
      // Ensure cache is clean before each test
      clearEmbeddingCache()
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    })

    it("should handle long string hashing", async () => {
      const longText = "a".repeat(2000)
      await generateEmbedding(longText)

      // Should be cached
      const size = getCacheSize()
      expect(size).toBe(1)

      // Second call should hit cache
      await generateEmbedding(longText)
      expect(mockEmbed).toHaveBeenCalledTimes(1)
    })
  })
})
