import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  searchHybrid,
  searchSimilarVectors,
  storeVector,
  vectorDb,
  getStorageStats
} from "../vector-store"
import { keywordIndexManager } from "@/lib/embeddings/keyword-index"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { STORAGE_KEYS } from "@/lib/constants"

// Mock dependencies
vi.mock("@/lib/embeddings/keyword-index", () => ({
  keywordIndexManager: {
    search: vi.fn(),
    addDocument: vi.fn(),
    removeDocument: vi.fn()
  }
}))

vi.mock("@/lib/embeddings/hnsw-index", () => ({
  hnswIndexManager: {
    addVector: vi.fn(),
    search: vi.fn(),
    shouldUseHNSW: vi.fn().mockResolvedValue(true) // Default to true
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

describe("Vector Store - Advanced Tests", () => {
  beforeEach(async () => {
    await vectorDb.vectors.clear()
    vi.clearAllMocks()
    
    // Default config mock
    vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({})
  })

  describe("searchHybrid", () => {
    it("should combine keyword and semantic results", async () => {
      // Setup data
      const doc1 = { id: 1, content: "Apple pie", embedding: [1, 0], metadata: { type: "chat", timestamp: 1 } }
      const doc2 = { id: 2, content: "Apple computer", embedding: [0, 1], metadata: { type: "chat", timestamp: 2 } }
      
      await vectorDb.vectors.bulkAdd([doc1, doc2] as any)

      // Mock keyword search results
      vi.mocked(keywordIndexManager.search).mockReturnValue([
        { id: 1, score: 10, document: doc1 as any, terms: ["apple"] }
      ])

      // Perform hybrid search
      // Query embedding [1, 0] matches doc1 perfectly
      const results = await searchHybrid("apple", [1, 0], {
        limit: 5,
        keywordWeight: 0.5,
        semanticWeight: 0.5
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].document.id).toBe(1)
      // Score should be combination of keyword (high) and semantic (high)
    })

    it("should respect weights", async () => {
      const doc1 = { id: 1, content: "Keyword match", embedding: [0, 1], metadata: { type: "chat", timestamp: 1 } }
      const doc2 = { id: 2, content: "Semantic match", embedding: [1, 0], metadata: { type: "chat", timestamp: 2 } }
      
      await vectorDb.vectors.bulkAdd([doc1, doc2] as any)

      // Keyword search finds doc1
      vi.mocked(keywordIndexManager.search).mockReturnValue([
        { id: 1, score: 10, document: doc1 as any, terms: ["keyword"] }
      ])

      // Semantic search (via internal searchSimilarVectors) will find doc2 for embedding [1, 0]

      // Case 1: High keyword weight
      const resultsKw = await searchHybrid("query", [1, 0], {
        keywordWeight: 0.9,
        semanticWeight: 0.1
      })
      expect(resultsKw[0].document.id).toBe(1)

      // Case 2: High semantic weight
      const resultsSem = await searchHybrid("query", [1, 0], {
        keywordWeight: 0.1,
        semanticWeight: 0.9
      })
      expect(resultsSem[0].document.id).toBe(2)
    })
  })

  describe("Storage Limits & Cleanup", () => {
    it("should enforce maxEmbeddingsPerFile", async () => {
      // Mock config with limit
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({
        maxEmbeddingsPerFile: 2
      })

      const fileId = "limited-file"
      
      await storeVector("Chunk 1", [1], { type: "file", fileId, timestamp: 1 })
      await storeVector("Chunk 2", [1], { type: "file", fileId, timestamp: 2 })

      // Should throw on 3rd
      await expect(storeVector("Chunk 3", [1], { type: "file", fileId, timestamp: 3 }))
        .rejects.toThrow("Maximum embeddings per file")
    })

    it("should auto-cleanup old vectors", async () => {
      // Mock config for cleanup
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({
        autoCleanup: true,
        cleanupDaysOld: 7
      })

      const oldDate = Date.now() - (8 * 24 * 60 * 60 * 1000) // 8 days old
      const newDate = Date.now()

      await vectorDb.vectors.add({
        content: "Old",
        embedding: [1],
        metadata: { type: "chat", timestamp: oldDate }
      } as any)

      // Trigger cleanup via storeVector
      await storeVector("New", [1], { type: "chat", timestamp: newDate })

      const all = await vectorDb.vectors.toArray()
      expect(all.length).toBe(1)
      expect(all[0].content).toBe("New")
    })
  })

  describe("Concurrency", () => {
    it("should handle concurrent storage requests", async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(storeVector(`Content ${i}`, [i], { type: "chat", timestamp: Date.now() }))
      }

      await Promise.all(promises)

      const count = await vectorDb.vectors.count()
      expect(count).toBe(10)
    })
  })

  describe("Internal Logic & Edge Cases", () => {
    it("should enforce maxStorageSize", async () => {
      // Mock config with very small storage limit (1KB)
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({
        maxStorageSize: 0.001 // 1KB approx
      })

      // Store enough vectors to exceed limit
      // Each vector is ~100 bytes overhead + content + embedding
      for (let i = 0; i < 20; i++) {
        await storeVector(`Content ${i}`, new Array(10).fill(0.1), { type: "chat", timestamp: Date.now() + i })
      }

      // Should have deleted some old ones
      const count = await vectorDb.vectors.count()
      expect(count).toBeLessThan(20)
      
      // Should have kept the newest ones
      const newest = await vectorDb.vectors.orderBy("metadata.timestamp").last()
      expect(newest?.content).toBe("Content 19")
    })

    it("should handle brute force search fallback", async () => {
      const { hnswIndexManager } = await import("@/lib/embeddings/hnsw-index")
      vi.mocked(hnswIndexManager.shouldUseHNSW).mockResolvedValue(false)

      await storeVector("Target", [1, 0], { type: "chat", timestamp: 1 })
      await storeVector("Noise", [0, 1], { type: "chat", timestamp: 2 })

      const results = await searchHybrid("Target", [1, 0], { limit: 1, semanticWeight: 1, keywordWeight: 0 })
      
      expect(results.length).toBe(1)
      expect(results[0].document.content).toBe("Target")
      expect(results[0].similarity).toBeCloseTo(1)
    })

    it("should handle large datasets with chunking", async () => {
      // Force brute force to test chunking logic
      const { hnswIndexManager } = await import("@/lib/embeddings/hnsw-index")
      vi.mocked(hnswIndexManager.shouldUseHNSW).mockResolvedValue(false)

      // Add enough vectors to trigger chunking (CHUNK_SIZE = 100)
      const vectors = []
      for (let i = 0; i < 150; i++) {
        vectors.push({
          content: `Doc ${i}`,
          embedding: [0.1, 0.1],
          metadata: { type: "chat", timestamp: Date.now() }
        })
      }
      await vectorDb.vectors.bulkAdd(vectors as any)

      const results = await searchSimilarVectors([0.1, 0.1], { limit: 5 })
      expect(results.length).toBe(5)
    })

    it("should fallback to brute force if HNSW search fails", async () => {
      const { hnswIndexManager } = await import("@/lib/embeddings/hnsw-index")
      vi.mocked(hnswIndexManager.shouldUseHNSW).mockResolvedValue(true)
      vi.mocked(hnswIndexManager.search).mockRejectedValue(new Error("HNSW Error"))

      await storeVector("Target", [1, 0], { type: "chat", timestamp: 1 })
      
      const results = await searchSimilarVectors([1, 0], { limit: 1 })
      expect(results.length).toBe(1)
      expect(results[0].document.content).toBe("Target")
    })

    it("should handle large cleanup batches with yielding", async () => {
      // Mock config to force cleanup
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({
        maxStorageSize: 0.001 // 1KB
      })

      // Add enough items to trigger the % 50 yield in cleanup loop
      const vectors = []
      for (let i = 0; i < 60; i++) {
        vectors.push({
          content: `Doc ${i}`,
          embedding: new Array(10).fill(0.1),
          metadata: { type: "chat", timestamp: i } // Old timestamps
        })
      }
      await vectorDb.vectors.bulkAdd(vectors as any)

      // Trigger cleanup by adding one more
      await storeVector("New", new Array(10).fill(0.1), { type: "chat", timestamp: 1000 })

      const count = await vectorDb.vectors.count()
      expect(count).toBeLessThan(60)
    })
  })
})
