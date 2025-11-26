import { beforeEach, describe, expect, it, vi } from "vitest"
import { hnswIndexManager } from "../hnsw-index"
import { clearAllVectors, storeVector } from "../vector-store"

describe("HNSW Index Manager", () => {
  beforeEach(async () => {
    // Clear database and index before each test
    await clearAllVectors()
    await hnswIndexManager.clearIndex()
  })

  describe("initialize", () => {
    it("should initialize index with specified dimension", async () => {
      await hnswIndexManager.initialize(384)

      const stats = hnswIndexManager.getStats()
      expect(stats.dimension).toBe(384)
      expect(stats.isInitialized).toBe(false) // No vectors yet
      expect(stats.numElements).toBe(0)
    })

    it("should allow re-initialization with different dimension", async () => {
      await hnswIndexManager.initialize(512)
      await hnswIndexManager.initialize(768)

      const stats = hnswIndexManager.getStats()
      expect(stats.dimension).toBe(768)
    })
  })

  describe("buildIndex", () => {
    it("should build index from empty database", async () => {
      await hnswIndexManager.buildIndex()

      const stats = hnswIndexManager.getStats()
      expect(stats.numElements).toBe(0)
      expect(stats.isBuilding).toBe(false)
    })

    it("should build index from vectors in database", async () => {
      // Store test vectors
      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      await storeVector("Test 1", embedding, {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })
      await storeVector("Test 2", embedding.map(v => v * 0.5), {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })

      await hnswIndexManager.buildIndex()

      const stats = hnswIndexManager.getStats()
      expect(stats.numElements).toBe(2)
      expect(stats.isInitialized).toBe(true)
      expect(stats.dimension).toBe(384)
    })

    it("should track build progress", async () => {
      // Store multiple vectors
      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      for (let i = 0; i < 10; i++) {
        await storeVector(`Test ${i}`, embedding, {
          type: "chat",
          sessionId: "test-session",
          timestamp: Date.now()
        })
      }

      const progressUpdates: number[] = []
      await hnswIndexManager.buildIndex((current, total) => {
        progressUpdates.push(current / total)
      })

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(1) // Final progress should be 100%
    })

    it("should not allow concurrent builds", async () => {
      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      await storeVector("Test", embedding, {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })

      // Start first build
      const build1 = hnswIndexManager.buildIndex()
      // Attempt second build immediately
      const build2 = hnswIndexManager.buildIndex()

      await Promise.all([build1, build2])

      const stats = hnswIndexManager.getStats()
      expect(stats.numElements).toBe(1) // Should only build once
    })
  })

  describe("addVector", () => {
    it("should add vector incrementally to index", async () => {
      await hnswIndexManager.initialize(384)

      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      await hnswIndexManager.addVector(1, embedding)

      const stats = hnswIndexManager.getStats()
      expect(stats.numElements).toBe(1)
    })

    it("should handle adding multiple vectors", async () => {
      await hnswIndexManager.initialize(384)

      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      await hnswIndexManager.addVector(1, embedding)
      await hnswIndexManager.addVector(2, embedding.map(v => v * 0.5))
      await hnswIndexManager.addVector(3, embedding.map(v => v * 0.25))

      const stats = hnswIndexManager.getStats()
      expect(stats.numElements).toBe(3)
    })
  })

  describe("search", () => {
    beforeEach(async () => {
      // Build index with test vectors
      const baseEmbedding = Array(384).fill(0).map((_, i) => i / 384)
      
      await storeVector("Document 1", baseEmbedding, {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })
      await storeVector("Document 2", baseEmbedding.map(v => v * 0.9), {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })
      await storeVector("Document 3", baseEmbedding.map(v => v * 0.5), {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })

      await hnswIndexManager.buildIndex()
    })

    it("should find nearest neighbors", async () => {
      const queryEmbedding = Array(384).fill(0).map((_, i) => i / 384)
      const results = await hnswIndexManager.search(queryEmbedding, 3)

      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(3)
      expect(results[0]).toHaveProperty("id")
      expect(results[0]).toHaveProperty("distance")
    })

    it("should return results sorted by similarity", async () => {
      const queryEmbedding = Array(384).fill(0).map((_, i) => i / 384)
      const results = await hnswIndexManager.search(queryEmbedding, 3)

      // Distances should be in descending order (higher similarity first)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i + 1].distance)
      }
    })

    it("should respect k limit", async () => {
      const queryEmbedding = Array(384).fill(0).map((_, i) => i / 384)
      const results = await hnswIndexManager.search(queryEmbedding, 2)

      expect(results.length).toBeLessThanOrEqual(2)
    })

    it("should return empty array for empty index", async () => {
      await hnswIndexManager.clearIndex()

      const queryEmbedding = Array(384).fill(0).map((_, i) => i / 384)
      const results = await hnswIndexManager.search(queryEmbedding, 10)

      expect(results).toEqual([])
    })
  })

  describe("clearIndex", () => {
    it("should clear all vectors from index", async () => {
      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      await storeVector("Test", embedding, {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })
      await hnswIndexManager.buildIndex()

      await hnswIndexManager.clearIndex()

      const stats = hnswIndexManager.getStats()
      expect(stats.numElements).toBe(0)
      expect(stats.isInitialized).toBe(false)
    })
  })

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      await storeVector("Test", embedding, {
        type: "chat",
        sessionId: "test-session",
        timestamp: Date.now()
      })
      await hnswIndexManager.buildIndex()

      const stats = hnswIndexManager.getStats()

      expect(stats).toHaveProperty("isInitialized")
      expect(stats).toHaveProperty("dimension")
      expect(stats).toHaveProperty("numElements")
      expect(stats).toHaveProperty("isBuilding")
      expect(stats).toHaveProperty("buildProgress")
      expect(stats).toHaveProperty("memorySizeMB")

      expect(stats.numElements).toBe(1)
      expect(stats.dimension).toBe(384)
      expect(stats.memorySizeMB).toBeGreaterThan(0)
    })
  })

  describe("shouldUseHNSW", () => {
    it("should return false when vector count is below threshold", async () => {
      const shouldUse = await hnswIndexManager.shouldUseHNSW(10)
      expect(shouldUse).toBe(false)
    })

    it("should return false when index is not built", async () => {
      const shouldUse = await hnswIndexManager.shouldUseHNSW(1000)
      expect(shouldUse).toBe(false)
    })

    it("should return true when conditions are met", async () => {
      // Build index with vectors
      const embedding = Array(384).fill(0).map((_, i) => i / 384)
      for (let i = 0; i < 5; i++) {
        await storeVector(`Test ${i}`, embedding, {
          type: "chat",
          sessionId: "test-session",
          timestamp: Date.now()
        })
      }
      await hnswIndexManager.buildIndex()

      const shouldUse = await hnswIndexManager.shouldUseHNSW(1000)
      expect(shouldUse).toBe(true)
    })
  })
})
