import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppError } from "@/lib/error-utils"
import {
  clearEmbeddingCache,
  cosineSimilarity,
  generateEmbedding,
  generateEmbeddingsBatch,
  getCacheSize,
  getCacheStats
} from "../embedding-client"

// Use vi.hoisted to ensure mockEmbed is defined before vi.mock runs
const { mockEmbed, route } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  /** Mutable stand-in for the resolved route, so a test can re-point it. */
  route: { id: "ollama", baseUrl: "http://localhost:11434" }
}))

// Mock plasmo storage
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined)
  }
}))

// Mock the provider factory with the hoisted mockEmbed
vi.mock("@/lib/providers/factory", () => {
  const build = () => ({
    id: route.id,
    config: { id: route.id, baseUrl: route.baseUrl },
    embed: (...args: unknown[]) => mockEmbed(...args)
  })

  return {
    ProviderFactory: {
      getProviderForModel: vi.fn(() => Promise.resolve(build())),
      getProvider: vi.fn(() => Promise.resolve(build()))
    }
  }
})

describe("Embedding Client", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEmbeddingCache()
    route.id = "ollama"
    route.baseUrl = "http://localhost:11434"

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
      expect(result).toHaveProperty("providerId")
      if ("embedding" in result) {
        expect(result.embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
      }
    })

    it("should use specified model", async () => {
      const result = await generateEmbedding("test", "custom-model")

      // mockEmbed should have been called with the text and model
      expect(mockEmbed).toHaveBeenCalledWith("test", "custom-model", undefined)
      if ("model" in result) {
        expect(result.model).toBe("custom-model")
        expect(result.providerId).toBe("ollama")
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
        expect(result.error).toBe("Error generating embedding")
      }
    })

    it("should handle network errors", async () => {
      mockEmbed.mockRejectedValue(new Error("Network error"))

      const result = await generateEmbedding("test")

      expect(result).toHaveProperty("error")
      if ("error" in result) {
        expect(result.error).toBe("Error generating embedding")
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
        expect(result.error).toBe("Error generating embedding")
      }
    })

    it("rejects non-finite vectors from a provider route", async () => {
      mockEmbed.mockResolvedValue([0.1, Number.NaN, 0.3])

      const result = await generateEmbedding("invalid-vector")

      expect(result).toHaveProperty("error")
      expect(mockEmbed).toHaveBeenCalledTimes(2)
    })

    /**
     * Every cause used to arrive as one string with code NETWORK_ERROR, so a
     * caller could not tell an abort from an unreachable provider and no
     * diagnostic could report which it was.
     */
    it("preserves the structured failure behind the message", async () => {
      mockEmbed.mockRejectedValue(
        createAppError("model not found", {
          kind: "provider",
          code: "OLC-MODEL-NOT-FOUND",
          phase: "response",
          retryable: false
        })
      )

      const result = await generateEmbedding("test")

      expect(result).toMatchObject({
        code: "OLC-MODEL-NOT-FOUND",
        failure: {
          kind: "provider",
          code: "OLC-MODEL-NOT-FOUND",
          phase: "response",
          retryable: false
        }
      })
    })

    it("propagates cancellation instead of entering retrieval fallback", async () => {
      const controller = new AbortController()
      mockEmbed.mockImplementation(() => {
        controller.abort()
        return Promise.reject(controller.signal.reason)
      })

      await expect(
        generateEmbedding("test", undefined, undefined, {
          signal: controller.signal
        })
      ).rejects.toMatchObject({ name: "AbortError" })
      // A cancelled route must not fall through to the next provider.
      expect(mockEmbed).toHaveBeenCalledTimes(1)
    })

    it("should recover using fallback route when first attempt fails", async () => {
      mockEmbed
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValue([0.2, 0.3, 0.4])

      const result = await generateEmbedding("fallback-test")

      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect("embedding" in result).toBe(true)
    })

    it("does not pin a transient fallback result in the primary cache", async () => {
      mockEmbed
        .mockRejectedValueOnce(new Error("primary temporarily unavailable"))
        .mockResolvedValueOnce([0.2, 0.3, 0.4])
        .mockResolvedValueOnce([0.9, 0.8, 0.7])

      const fallback = await generateEmbedding("route-recovery")
      const recovered = await generateEmbedding("route-recovery")

      expect(mockEmbed).toHaveBeenCalledTimes(3)
      expect(fallback).toMatchObject({ embedding: [0.2, 0.3, 0.4] })
      expect(recovered).toMatchObject({ embedding: [0.9, 0.8, 0.7] })
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

    /**
     * The previous sampled hash bounded its loop by the sample count rather
     * than the text length, so it only ever read positions inside the first
     * 1000 characters. Two long chunks sharing an opening collided and the
     * second silently received the first's vector.
     */
    it("distinguishes long texts that differ only after the first 1000 chars", async () => {
      const shared = "a".repeat(1000)
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3])
      mockEmbed.mockResolvedValueOnce([0.9, 0.8, 0.7])

      const first = await generateEmbedding(`${shared}${"b".repeat(1000)}`)
      const second = await generateEmbedding(`${shared}${"c".repeat(1000)}`)

      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect(getCacheSize()).toBe(2)
      expect(first).toMatchObject({ embedding: [0.1, 0.2, 0.3] })
      expect(second).toMatchObject({ embedding: [0.9, 0.8, 0.7] })
    })

    /**
     * The key used to describe configured intent — shared provider id and
     * stored model — while the vector could come from any route in the plan.
     * Switching provider then returned the previous provider's vector for the
     * same text, at whatever dimension that provider used.
     */
    it("misses the cache when the resolved provider changes", async () => {
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3])
      mockEmbed.mockResolvedValueOnce([0.9, 0.8, 0.7, 0.6])

      const first = await generateEmbedding("same text")
      route.id = "lm studio"
      const second = await generateEmbedding("same text")

      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect(first).toMatchObject({ embedding: [0.1, 0.2, 0.3] })
      expect(second).toMatchObject({ embedding: [0.9, 0.8, 0.7, 0.6] })
    })

    it("misses the cache when the same provider is re-pointed at another endpoint", async () => {
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3])
      mockEmbed.mockResolvedValueOnce([0.4, 0.5, 0.6])

      const first = await generateEmbedding("same text")
      route.baseUrl = "http://192.168.1.10:11434"
      const second = await generateEmbedding("same text")

      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect(first).toMatchObject({ embedding: [0.1, 0.2, 0.3] })
      expect(second).toMatchObject({ embedding: [0.4, 0.5, 0.6] })
    })

    it("distinguishes texts differing only in trailing length", async () => {
      mockEmbed.mockReset()
      mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])

      await generateEmbedding("a".repeat(1500))
      await generateEmbedding("a".repeat(1501))

      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect(getCacheSize()).toBe(2)
    })
  })
})
