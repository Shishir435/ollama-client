import { beforeEach, describe, expect, it } from "vitest"
import {
  clearAllVectors,
  deleteVectors,
  getStorageStats,
  getVectorsByContext,
  searchSimilarVectors,
  storeVector,
  vectorDb
} from "../vector-store"

describe("Vector Store - Baseline Tests", () => {
  beforeEach(async () => {
    // Clear database before each test
    await clearAllVectors()
  })

  describe("storeVector", () => {
    it("should store a vector document with embedding", async () => {
      const content = "This is a test document"
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      const metadata = {
        type: "chat" as const,
        sessionId: "test-session",
        timestamp: Date.now()
      }

      const id = await storeVector(content, embedding, metadata)

      expect(id).toBeGreaterThan(0)

      // Verify stored
      const stored = await vectorDb.vectors.get(id)
      expect(stored).toBeDefined()
      expect(stored?.content).toBe(content)
      expect(stored?.embedding).toEqual(embedding)
      expect(stored?.metadata.sessionId).toBe("test-session")
    })

    it("should normalize embeddings on storage", async () => {
      const content = "Test normalization"
      const embedding = [3, 4] // L2 norm = 5
      const metadata = {
        type: "file" as const,
        fileId: "test-file",
        timestamp: Date.now()
      }

      const id = await storeVector(content, embedding, metadata)
      const stored = await vectorDb.vectors.get(id)

      expect(stored?.normalizedEmbedding).toBeDefined()
      expect(stored?.norm).toBeCloseTo(5, 5)
      expect(stored?.normalizedEmbedding?.[0]).toBeCloseTo(0.6, 5) // 3/5
      expect(stored?.normalizedEmbedding?.[1]).toBeCloseTo(0.8, 5) // 4/5
    })

    it("should prevent duplicate content in same session", async () => {
      const content = "Duplicate content"
      const embedding = [0.1, 0.2, 0.3]
      const metadata = {
        type: "chat" as const,
        sessionId: "same-session",
        timestamp: Date.now()
      }

      const id1 = await storeVector(content, embedding, metadata)
      const id2 = await storeVector(content, embedding, metadata)

      expect(id1).toBe(id2) // Should return same ID
      const count = await vectorDb.vectors.count()
      expect(count).toBe(1) // Only one document stored
    })
  })

  describe("searchSimilarVectors", () => {
    beforeEach(async () => {
      // Store test vectors
      await storeVector("The quick brown fox", [1, 0, 0], {
        type: "chat",
        sessionId: "session1",
        timestamp: Date.now()
      })
      await storeVector("The lazy dog", [0, 1, 0], {
        type: "chat",
        sessionId: "session1",
        timestamp: Date.now()
      })
      await storeVector("Cats and dogs", [0, 0, 1], {
        type: "chat",
        sessionId: "session2",
        timestamp: Date.now()
      })
    })

    it("should find similar vectors using cosine similarity", async () => {
      const queryEmbedding = [1, 0, 0] // Same as "The quick brown fox"
      const results = await searchSimilarVectors(queryEmbedding, { limit: 3 })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].similarity).toBeCloseTo(1, 2) // Perfect match
      expect(results[0].document.content).toBe("The quick brown fox")
    })

    it("should filter by session ID", async () => {
      const queryEmbedding = [0.5, 0.5, 0]
      const results = await searchSimilarVectors(queryEmbedding, {
        sessionId: "session1",
        limit: 10
      })

      expect(results.length).toBe(2) // Only session1 results
      results.forEach((r) => {
        expect(r.document.metadata.sessionId).toBe("session1")
      })
    })

    it("should filter by minimum similarity threshold", async () => {
      const queryEmbedding = [1, 0, 0]
      const results = await searchSimilarVectors(queryEmbedding, {
        minSimilarity: 0.8,
        limit: 10
      })

      results.forEach((r) => {
        expect(r.similarity).toBeGreaterThanOrEqual(0.8)
      })
    })

    it("should limit results correctly", async () => {
      const queryEmbedding = [0.5, 0.5, 0.5]
      const results = await searchSimilarVectors(queryEmbedding, { limit: 1 })

      expect(results.length).toBeLessThanOrEqual(1)
    })
  })

  describe("deleteVectors", () => {
    it("should delete vectors by session ID", async () => {
      await storeVector("Test 1", [1, 0, 0], {
        type: "chat",
        sessionId: "delete-me",
        timestamp: Date.now()
      })
      await storeVector("Test 2", [0, 1, 0], {
        type: "chat",
        sessionId: "keep-me",
        timestamp: Date.now()
      })

      const deleted = await deleteVectors({ sessionId: "delete-me" })
      expect(deleted).toBe(1)

      const remaining = await getVectorsByContext({ sessionId: "delete-me" })
      expect(remaining.length).toBe(0)

      const kept = await getVectorsByContext({ sessionId: "keep-me" })
      expect(kept.length).toBe(1)
    })

    it("should delete vectors by file ID", async () => {
      await storeVector("File chunk", [1, 0, 0], {
        type: "file",
        fileId: "file-123",
        timestamp: Date.now()
      })

      const deleted = await deleteVectors({ fileId: "file-123" })
      expect(deleted).toBe(1)
    })
  })

  describe("getStorageStats", () => {
    it("should return accurate storage statistics", async () => {
      await storeVector("Chat message", [1, 0, 0], {
        type: "chat",
        sessionId: "test",
        timestamp: Date.now()
      })
      await storeVector("File content", [0, 1, 0], {
        type: "file",
        fileId: "file-1",
        timestamp: Date.now()
      })

      const stats = await getStorageStats()

      expect(stats.totalVectors).toBe(2)
      expect(stats.totalSizeMB).toBeGreaterThan(0)
      expect(stats.byType.chat).toBe(1)
      expect(stats.byType.file).toBe(1)
    })
  })

  describe("getVectorsByContext", () => {
    it("should retrieve all vectors for a session", async () => {
      const sessionId = "test-session"
      await storeVector("Message 1", [1, 0, 0], {
        type: "chat",
        sessionId,
        timestamp: Date.now()
      })
      await storeVector("Message 2", [0, 1, 0], {
        type: "chat",
        sessionId,
        timestamp: Date.now()
      })

      const vectors = await getVectorsByContext({ sessionId })

      expect(vectors.length).toBe(2)
      vectors.forEach((v) => {
        expect(v.metadata.sessionId).toBe(sessionId)
      })
    })
  })
})
