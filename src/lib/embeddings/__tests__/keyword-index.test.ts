import { beforeEach, describe, expect, it } from "vitest"
import { keywordIndexManager } from "../keyword-index"
import type { VectorDocument } from "../vector-store"

describe("Keyword Index Manager", () => {
  beforeEach(() => {
    // Clear index before each test
    keywordIndexManager.clear()
  })

  describe("addDocument", () => {
    it("should add document to keyword index", () => {
      const document: VectorDocument = {
        id: 1,
        content: "The quick brown fox jumps over the lazy dog",
        embedding: [0.1, 0.2, 0.3],
        metadata: {
          type: "chat",
          sessionId: "test-session",
          timestamp: Date.now()
        }
      }

      keywordIndexManager.addDocument(1, document.content, document)

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(1)
    })

    it("should update existing document", () => {
      const doc1: VectorDocument = {
        id: 1,
        content: "First version",
        embedding: [0.1, 0.2, 0.3],
        metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
      }
      const doc2: VectorDocument = {
        id: 1,
        content: "Second version",
        embedding: [0.1, 0.2, 0.3],
        metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
      }

      keywordIndexManager.addDocument(1, doc1.content, doc1)
      keywordIndexManager.addDocument(1, doc2.content, doc2)

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(1) // Should replace, not add new
    })

    it("should handle multiple documents", () => {
      for (let i = 1; i <= 5; i++) {
        const doc: VectorDocument = {
          id: i,
          content: `Document ${i}`,
          embedding: [0.1, 0.2, 0.3],
          metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
        }
        keywordIndexManager.addDocument(i, doc.content, doc)
      }

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(5)
    })
  })

  describe("search", () => {
    beforeEach(() => {
      // Add test documents
      const documents = [
        { id: 1, content: "JavaScript programming language" },
        { id: 2, content: "Python programming tutorial" },
        { id: 3, content: "Web development with React" },
        { id: 4, content: "Machine learning in Python" },
        { id: 5, content: "TypeScript advanced features" }
      ]

      documents.forEach(({ id, content }) => {
        const doc: VectorDocument = {
          id,
          content,
          embedding: [0.1, 0.2, 0.3],
          metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
        }
        keywordIndexManager.addDocument(id, content, doc)
      })
    })

    it("should find exact keyword matches", () => {
      const results = keywordIndexManager.search("Python")

      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.document.content.includes("Python"))).toBe(true)
    })

    it("should be case-insensitive", () => {
      const results1 = keywordIndexManager.search("python")
      const results2 = keywordIndexManager.search("PYTHON")
      const results3 = keywordIndexManager.search("Python")

      expect(results1.length).toBe(results2.length)
      expect(results2.length).toBe(results3.length)
    })

    it("should find multiple documents for common terms", () => {
      const results = keywordIndexManager.search("programming")

      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results.every(r => r.document.content.toLowerCase().includes("programming"))).toBe(true)
    })

    it("should support fuzzy search for typos", () => {
      const results = keywordIndexManager.search("Pythn", { fuzzy: 0.3 })

      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.document.content.includes("Python"))).toBe(true)
    })

    it("should support prefix matching", () => {
      const results = keywordIndexManager.search("prog", { prefix: true })

      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.document.content.toLowerCase().includes("programming"))).toBe(true)
    })

    it("should respect limit option", () => {
      const results = keywordIndexManager.search("programming", { limit: 1 })

      expect(results.length).toBeLessThanOrEqual(1)
    })

    it("should return results with scores", () => {
      const results = keywordIndexManager.search("Python")

      expect(results.length).toBeGreaterThan(0)
      results.forEach(result => {
        expect(result).toHaveProperty("score")
        expect(result.score).toBeGreaterThan(0)
      })
    })

    it("should return matched terms", () => {
      const results = keywordIndexManager.search("Python programming")

      expect(results.length).toBeGreaterThan(0)
      results.forEach(result => {
        expect(result).toHaveProperty("terms")
        expect(Array.isArray(result.terms)).toBe(true)
      })
    })

    it("should handle empty query", () => {
      const results = keywordIndexManager.search("")

      expect(results).toEqual([])
    })

    it("should handle query with no matches", () => {
      const results = keywordIndexManager.search("nonexistent_term_12345")

      expect(results).toEqual([])
    })

    it("should support AND combination", () => {
      const results = keywordIndexManager.search("Python programming", {
        combineWith: "AND"
      })

      results.forEach(result => {
        const content = result.document.content.toLowerCase()
        expect(content.includes("python") && content.includes("programming")).toBe(true)
      })
    })

    it("should support OR combination", () => {
      const results = keywordIndexManager.search("Python JavaScript", {
        combineWith: "OR"
      })

      expect(results.length).toBeGreaterThan(0)
      results.forEach(result => {
        const content = result.document.content.toLowerCase()
        expect(content.includes("python") || content.includes("javascript")).toBe(true)
      })
    })
  })

  describe("removeDocument", () => {
    it("should remove document from index", () => {
      const doc: VectorDocument = {
        id: 1,
        content: "Test document",
        embedding: [0.1, 0.2, 0.3],
        metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
      }

      keywordIndexManager.addDocument(1, doc.content, doc)
      expect(keywordIndexManager.getStats().documentCount).toBe(1)

      keywordIndexManager.removeDocument(1)
      expect(keywordIndexManager.getStats().documentCount).toBe(0)
    })

    it("should handle removing non-existent document", () => {
      keywordIndexManager.removeDocument(999)
      expect(keywordIndexManager.getStats().documentCount).toBe(0)
    })

    it("should allow re-adding after removal", () => {
      const doc: VectorDocument = {
        id: 1,
        content: "Test document",
        embedding: [0.1, 0.2, 0.3],
        metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
      }

      keywordIndexManager.addDocument(1, doc.content, doc)
      keywordIndexManager.removeDocument(1)
      keywordIndexManager.addDocument(1, doc.content, doc)

      expect(keywordIndexManager.getStats().documentCount).toBe(1)
    })
  })

  describe("clear", () => {
    it("should clear all documents", () => {
      for (let i = 1; i <= 5; i++) {
        const doc: VectorDocument = {
          id: i,
          content: `Document ${i}`,
          embedding: [0.1, 0.2, 0.3],
          metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
        }
        keywordIndexManager.addDocument(i, doc.content, doc)
      }

      keywordIndexManager.clear()

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(0)
    })
  })

  describe("getStats", () => {
    it("should return correct statistics", () => {
      const stats = keywordIndexManager.getStats()

      expect(stats).toHaveProperty("documentCount")
      expect(stats).toHaveProperty("termCount")
      expect(stats).toHaveProperty("memorySizeMB")
      expect(stats.documentCount).toBe(0)
    })

    it("should update stats when documents are added", () => {
      const doc: VectorDocument = {
        id: 1,
        content: "Test document",
        embedding: [0.1, 0.2, 0.3],
        metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
      }

      keywordIndexManager.addDocument(1, doc.content, doc)

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(1)
      expect(stats.termCount).toBe(1)
    })
  })

  describe("buildFromDocuments", () => {
    it("should build index from document array", async () => {
      const documents: VectorDocument[] = []
      for (let i = 1; i <= 10; i++) {
        documents.push({
          id: i,
          content: `Document ${i} content`,
          embedding: [0.1, 0.2, 0.3],
          metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
        })
      }

      await keywordIndexManager.buildFromDocuments(documents)

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(10)
    })

    it("should track build progress", async () => {
      const documents: VectorDocument[] = []
      for (let i = 1; i <= 20; i++) {
        documents.push({
          id: i,
          content: `Document ${i}`,
          embedding: [0.1, 0.2, 0.3],
          metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
        })
      }

      const progressUpdates: number[] = []
      await keywordIndexManager.buildFromDocuments(documents, (current, total) => {
        progressUpdates.push(current / total)
      })

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(1) // Final progress should be 100%
    })

    it("should clear existing index before building", async () => {
      // Add initial documents
      const doc1: VectorDocument = {
        id: 1,
        content: "Initial document",
        embedding: [0.1, 0.2, 0.3],
        metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
      }
      keywordIndexManager.addDocument(1, doc1.content, doc1)

      // Build from new documents
      const newDocuments: VectorDocument[] = [{
        id: 2,
        content: "New document",
        embedding: [0.1, 0.2, 0.3],
        metadata: { type: "chat", sessionId: "test", timestamp: Date.now() }
      }]

      await keywordIndexManager.buildFromDocuments(newDocuments)

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(1) // Should only have new document
    })

    it("should handle empty document array", async () => {
      await keywordIndexManager.buildFromDocuments([])

      const stats = keywordIndexManager.getStats()
      expect(stats.documentCount).toBe(0)
    })
  })
})
