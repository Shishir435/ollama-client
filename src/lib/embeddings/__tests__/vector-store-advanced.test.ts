import { beforeEach, describe, expect, it, vi } from "vitest"
import { EmbeddingService } from "@/application/embeddings/embedding-service"
import type { KeywordIndexDocument } from "@/lib/embeddings/keyword-index"
import { keywordIndexManager } from "@/lib/embeddings/keyword-index"
import { VectorStorageFullError } from "@/lib/embeddings/vector-storage-full"
import {
  noteVectorStorageFull,
  noteVectorStorageHasRoom
} from "@/lib/embeddings/vector-storage-full-notice"
import { emptyVectorStorageStats } from "@/lib/embeddings/vector-storage-stats"
import type { VectorDocument } from "@/lib/embeddings/vector-store"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import {
  fromDocuments,
  searchHybrid,
  searchSimilarVectors,
  storeVector,
  vectorDb
} from "../vector-store"

// Mock dependencies
vi.mock("@/lib/embeddings/keyword-index", () => ({
  keywordIndexManager: {
    buildFromBatches: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    search: vi.fn(),
    addDocument: vi.fn(),
    removeDocument: vi.fn()
  }
}))

vi.mock("@/lib/embeddings/vector-storage-full-notice", () => ({
  noteVectorStorageFull: vi.fn().mockResolvedValue(undefined),
  noteVectorStorageHasRoom: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn()
}))

/**
 * Mirrors the projection the real index retains: metadata + the
 * dimension captured at add time, and deliberately no vectors. Keeping the
 * fixture in this shape is what makes these mocks exercise the rehydration
 * path instead of handing `searchHybrid` a row it no longer receives.
 */
const keywordDoc = (doc: VectorDocument): KeywordIndexDocument => ({
  id: doc.id,
  embeddingDim: doc.metadata.embeddingDim ?? doc.embedding.length,
  metadata: doc.metadata
})

describe("Vector Store - Advanced Tests", () => {
  beforeEach(async () => {
    await vectorDb.vectors.clear()
    await vectorDb.vectorStats.put(emptyVectorStorageStats())
    vi.clearAllMocks()

    // Default config mock
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({})
  })

  describe("searchHybrid", () => {
    it("should combine keyword and semantic results", async () => {
      // Setup data
      const doc1 = {
        id: 1,
        content: "Apple pie",
        embedding: [1, 0],
        metadata: { source: "", type: "chat", timestamp: 1 }
      }
      const doc2 = {
        id: 2,
        content: "Apple computer",
        embedding: [0, 1],
        metadata: { source: "", type: "chat", timestamp: 2 }
      }

      await vectorDb.vectors.bulkAdd([doc1, doc2] as any)

      // Mock keyword search results
      vi.mocked(keywordIndexManager.search).mockReturnValue([
        {
          id: 1,
          score: 10,
          document: keywordDoc(doc1 as never),
          terms: ["apple"]
        }
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
      const doc1 = {
        id: 1,
        content: "Keyword match",
        embedding: [0, 1],
        metadata: { source: "", type: "chat", timestamp: 1 }
      }
      const doc2 = {
        id: 2,
        content: "Semantic match",
        embedding: [1, 0],
        metadata: { source: "", type: "chat", timestamp: 2 }
      }

      await vectorDb.vectors.bulkAdd([doc1, doc2] as any)

      // Keyword search finds doc1
      vi.mocked(keywordIndexManager.search).mockReturnValue([
        {
          id: 1,
          score: 10,
          document: keywordDoc(doc1 as never),
          terms: ["keyword"]
        }
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
      vi.mocked(getPlasmoStoredValue).mockResolvedValue({
        maxEmbeddingsPerFile: 2
      })

      const fileId = "limited-file"

      await storeVector("Chunk 1", [1], {
        source: "",
        type: "file",
        fileId,
        timestamp: 1
      })
      await storeVector("Chunk 2", [1], {
        source: "",
        type: "file",
        fileId,
        timestamp: 2
      })

      // Should throw on 3rd
      await expect(
        storeVector("Chunk 3", [1], {
          source: "",
          type: "file",
          fileId,
          timestamp: 3
        })
      ).rejects.toThrow("Maximum embeddings per file")
    })

    it("should auto-cleanup old vectors", async () => {
      // Mock config for cleanup
      vi.mocked(getPlasmoStoredValue).mockResolvedValue({
        autoCleanup: true,
        cleanupDaysOld: 7
      })

      const oldDate = Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 days old
      const newDate = Date.now()

      await vectorDb.vectors.add({
        content: "Old",
        embedding: [1],
        metadata: { source: "", type: "chat", timestamp: oldDate }
      } as any)

      // Trigger cleanup via storeVector
      await storeVector("New", [1], {
        source: "",
        type: "chat",
        timestamp: newDate
      })

      const all = await vectorDb.vectors.toArray()
      expect(all.length).toBe(1)
      expect(all[0].content).toBe("New")
    })
  })

  describe("Concurrency", () => {
    it("should handle concurrent storage requests", async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          storeVector(`Content ${i}`, [i], {
            type: "chat",
            source: "",
            timestamp: Date.now()
          })
        )
      }

      await Promise.all(promises)

      const count = await vectorDb.vectors.count()
      expect(count).toBe(10)
    })
  })

  describe("Internal Logic & Edge Cases", () => {
    it("should refuse to store past maxStorageSize instead of deleting", async () => {
      vi.mocked(getPlasmoStoredValue).mockResolvedValue({
        maxStorageSize: 0.001 // 1KB approx
      })

      let refused: unknown
      for (let i = 0; i < 20; i++) {
        try {
          await storeVector(
            `Content ${i}`,
            Array.from({ length: 10 }, () => 0.1),
            { type: "chat", source: "", timestamp: Date.now() + i }
          )
        } catch (error) {
          refused = error
          break
        }
      }

      expect(refused).toBeInstanceOf(VectorStorageFullError)
      const oldest = await vectorDb.vectors
        .orderBy("metadata.timestamp")
        .first()
      expect(oldest?.content).toBe("Content 0")
    })

    it("tells the notice about a refusal, and clears it only for a vector that was added", async () => {
      vi.mocked(getPlasmoStoredValue).mockResolvedValue({
        maxStorageSize: 0.001
      })
      const metadata = {
        type: "chat" as const,
        source: "",
        sessionId: "s1",
        timestamp: 1
      }
      await storeVector("Same chunk", [0.1, 0.2], metadata)
      expect(noteVectorStorageHasRoom).toHaveBeenCalledTimes(1)

      // The same chunk again is found, not added, so it never met the limit.
      await storeVector("Same chunk", [0.1, 0.2], metadata)
      expect(noteVectorStorageHasRoom).toHaveBeenCalledTimes(1)

      let refused: unknown
      for (let i = 0; i < 20 && !refused; i++) {
        try {
          await storeVector(
            `Other chunk ${i}`,
            Array.from({ length: 64 }, () => 0.1),
            {
              ...metadata,
              sessionId: `other-${i}`,
              timestamp: 2 + i
            }
          )
        } catch (error) {
          refused = error
        }
      }
      expect(refused).toBeInstanceOf(VectorStorageFullError)
      expect(noteVectorStorageFull).toHaveBeenCalledWith(0.001)
    })

    it("should stop a batch at the first refusal even when not strict", async () => {
      vi.mocked(getPlasmoStoredValue).mockResolvedValue({
        maxStorageSize: 0.001
      })

      vi.spyOn(EmbeddingService, "generate").mockResolvedValue({
        embedding: Array.from({ length: 10 }, () => 0.1),
        model: "test-model",
        providerId: "ollama"
      } as never)
      await expect(
        fromDocuments(
          Array.from({ length: 20 }, (_, i) => ({
            pageContent: `Doc ${i}`,
            metadata: { source: "", type: "file" as const }
          }))
        )
      ).rejects.toBeInstanceOf(VectorStorageFullError)
    })

    it("should handle brute force search fallback", async () => {
      await storeVector("Target", [1, 0], {
        source: "",
        type: "chat",
        timestamp: 1
      })
      await storeVector("Noise", [0, 1], {
        source: "",
        type: "chat",
        timestamp: 2
      })

      const results = await searchHybrid("Target", [1, 0], {
        limit: 1,
        semanticWeight: 1,
        keywordWeight: 0
      })

      expect(results.length).toBe(1)
      expect(results[0].document.content).toBe("Target")
      expect(results[0].similarity).toBeCloseTo(1)
    })

    it("should handle large datasets with chunking", async () => {
      // Force brute force to test chunking logic
      // Add enough vectors to trigger chunking (CHUNK_SIZE = 100)
      const vectors = []
      for (let i = 0; i < 150; i++) {
        vectors.push({
          content: `Doc ${i}`,
          embedding: [0.1, 0.1],
          metadata: { source: "", type: "chat", timestamp: Date.now() }
        })
      }
      await vectorDb.vectors.bulkAdd(vectors as any)

      const results = await searchSimilarVectors([0.1, 0.1], { limit: 5 })
      expect(results.length).toBe(5)
    })

    it("should filter by embedding model and provider", async () => {
      const doc1 = {
        id: 1,
        content: "Doc Ollama",
        embedding: [0, 1],
        metadata: {
          source: "",
          type: "chat",
          timestamp: 1,
          embeddingModel: "all-minilm:latest",
          embeddingProviderId: "ollama",
          embeddingDim: 2
        }
      }
      const doc2 = {
        id: 2,
        content: "Doc LM Studio",
        embedding: [1, 0],
        metadata: {
          source: "",
          type: "chat",
          timestamp: 2,
          embeddingModel: "nomic-embed-text",
          embeddingProviderId: "lm studio",
          embeddingDim: 2
        }
      }

      await vectorDb.vectors.bulkAdd([doc1, doc2] as any)

      const results = await searchSimilarVectors([1, 0], {
        limit: 5,
        embeddingModel: "nomic-embed-text",
        embeddingProviderId: "lm studio",
        embeddingDimension: 2
      })

      expect(results.length).toBe(1)
      expect(results[0].document.id).toBe(2)
    })

    it("should allow legacy vectors without providerId when model matches", async () => {
      const legacyDoc = {
        id: 1,
        content: "Legacy doc",
        embedding: [1, 0],
        metadata: {
          source: "",
          type: "chat",
          timestamp: 1,
          embeddingModel: "all-minilm:latest",
          embeddingDim: 2
        }
      }

      await vectorDb.vectors.bulkAdd([legacyDoc] as any)

      const results = await searchSimilarVectors([1, 0], {
        limit: 5,
        embeddingModel: "all-minilm:latest",
        embeddingProviderId: "ollama",
        embeddingDimension: 2
      })

      expect(results.length).toBe(1)
      expect(results[0].document.id).toBe(1)
    })

    it("ranks inside the scoped corpus before taking top-K", async () => {
      const eligibleId = await vectorDb.vectors.add({
        content: "Eligible",
        embedding: [1, 0],
        metadata: {
          source: "",
          type: "chat",
          sessionId: "eligible",
          timestamp: 1
        }
      } as any)
      await vectorDb.vectors.add({
        content: "Noise",
        embedding: [1, 0],
        metadata: {
          source: "",
          type: "chat",
          sessionId: "noise",
          timestamp: 2
        }
      } as any)
      const results = await searchSimilarVectors([1, 0], {
        limit: 1,
        sessionId: "eligible"
      })

      expect(results.map((result) => result.document.id)).toEqual([eligibleId])
    })
  })
})
